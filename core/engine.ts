// The reasoning engine. Transport-agnostic: the MCP server and the REST
// route are both thin callers of planShootWindow().
//
// Scoring model:
//   - each factor produces a 0..1 sub-score (higher = better for the shoot)
//   - target-dependent weights combine them into a composite
//   - confidence bands on the composite, capped when a source degraded
//   - the evidence trail carries every sub-score, and flags the factor that
//     most drove (or most capped) the result as `dominant`

import { sunAltitude } from './astronomy/sun.js';
import { moonState } from './astronomy/moon.js';
import { resolveLocation } from './adapters/geocode.js';
import { fetchHourlyWeather } from './adapters/weather.js';
import { lookupBortle } from './adapters/bortle.js';
import type {
	Confidence,
	EvidenceItem,
	HourlyWeather,
	PlanInput,
	PlanResult,
	SourceStatus,
	Target,
	WeightLabel,
} from './types.js';

// ---------------------------------------------------------------- weights

const WEIGHTS: Record<Target, { cloud: number; moon: number; bortle: number }> = {
	milky_way: { cloud: 0.4, moon: 0.35, bortle: 0.25 },
	moon: { cloud: 0.5, moon: 0.4, bortle: 0.1 },
	planets: { cloud: 0.6, moon: 0.2, bortle: 0.2 },
	general: { cloud: 0.34, moon: 0.33, bortle: 0.33 },
};

function weightLabel(weight: number): WeightLabel {
	if (weight >= 0.35) return 'high';
	if (weight >= 0.2) return 'medium';
	return 'low';
}

// ------------------------------------------------------------- date range

export function parseDateRange(range: string | undefined): number {
	if (!range) return 7;
	const lower = range.toLowerCase();
	if (/tonight|today/.test(lower)) return 1;
	if (/weekend/.test(lower)) return 7;
	const match = lower.match(/(\d+)\s*(?:day|night)/);
	if (match) return Math.min(Math.max(Number(match[1]), 1), 14);
	return 7;
}

// ----------------------------------------------------------------- nights

interface NightHour {
	time: Date; // UTC instant
	sunAltitude: number;
	cloudCover: number | null;
	moonUp: boolean;
}

interface Night {
	/** Local calendar date of the evening the night starts on. */
	dateLabel: string;
	hours: NightHour[]; // dark hours only
	avgCloud: number | null;
	moonIllumination: number;
	moonPhaseName: string;
	moonUpFraction: number;
}

const DARK_SUN_ALT = -12; // nautical darkness — usable even at higher latitudes

function localDate(time: Date, offsetSeconds: number): Date {
	return new Date(time.getTime() + offsetSeconds * 1000);
}

function localDateLabel(time: Date, offsetSeconds: number): string {
	const local = localDate(time, offsetSeconds);
	// A dark hour after local midnight belongs to the previous evening's night.
	const anchor =
		local.getUTCHours() < 12 ? new Date(local.getTime() - 86400000) : local;
	return anchor.toISOString().slice(0, 10);
}

function formatLocalTime(time: Date, offsetSeconds: number): string {
	const local = localDate(time, offsetSeconds);
	let h = local.getUTCHours();
	const m = local.getUTCMinutes();
	const suffix = h >= 12 ? 'PM' : 'AM';
	h = h % 12 || 12;
	return `${h}:${String(m).padStart(2, '0')}${suffix}`;
}

function buildNights(
	latitude: number,
	longitude: number,
	weather: HourlyWeather | null,
	days: number,
	now: () => Date,
): Night[] {
	// With weather: walk its hourly grid. Without: synthesize a UTC-hourly
	// grid and estimate the offset from longitude (only used for labels).
	const offsetSeconds = weather?.utcOffsetSeconds ?? Math.round(longitude / 15) * 3600;
	const hours: NightHour[] = [];

	if (weather) {
		weather.times.forEach((time, i) => {
			const alt = sunAltitude(time, latitude, longitude);
			if (alt >= DARK_SUN_ALT) return;
			hours.push({
				time,
				sunAltitude: alt,
				cloudCover: weather.cloudCover[i] ?? null,
				moonUp: moonState(time, latitude, longitude).altitude > 0,
			});
		});
	} else {
		const start = now();
		start.setUTCMinutes(0, 0, 0);
		for (let i = 0; i < days * 24; i++) {
			const time = new Date(start.getTime() + i * 3600000);
			const alt = sunAltitude(time, latitude, longitude);
			if (alt >= DARK_SUN_ALT) continue;
			hours.push({
				time,
				sunAltitude: alt,
				cloudCover: null,
				moonUp: moonState(time, latitude, longitude).altitude > 0,
			});
		}
	}

	// Group dark hours into nights by local evening date.
	const byNight = new Map<string, NightHour[]>();
	for (const hour of hours) {
		const key = localDateLabel(hour.time, offsetSeconds);
		const bucket = byNight.get(key) ?? [];
		bucket.push(hour);
		byNight.set(key, bucket);
	}

	const nights: Night[] = [];
	for (const [dateLabel, nightHours] of byNight) {
		if (nightHours.length < 2) continue; // too short to plan a shoot in
		const clouds = nightHours
			.map((h) => h.cloudCover)
			.filter((c): c is number => c !== null);
		const midnight = nightHours[Math.floor(nightHours.length / 2)]!;
		const moon = moonState(midnight.time, latitude, longitude);
		nights.push({
			dateLabel,
			hours: nightHours,
			avgCloud: clouds.length ? clouds.reduce((a, b) => a + b, 0) / clouds.length : null,
			moonIllumination: moon.illumination,
			moonPhaseName: moon.phaseName,
			moonUpFraction: nightHours.filter((h) => h.moonUp).length / nightHours.length,
		});
	}
	return nights;
}

// ---------------------------------------------------------------- scoring

interface NightScore {
	night: Night;
	cloudScore: number | null;
	moonScore: number;
	bortleScore: number;
	composite: number;
}

function moonSubScore(night: Night, target: Target): number {
	const lit = night.moonIllumination * night.moonUpFraction; // moonlight actually in the sky
	switch (target) {
		case 'moon':
			// Shooting the moon: it needs to be up and lit.
			return night.moonIllumination * Math.min(night.moonUpFraction * 2, 1);
		case 'planets':
			// Bright planets tolerate moonlight; mild glare penalty only.
			return 1 - 0.5 * lit;
		default:
			// Milky Way / general: moonlight is the enemy, but a set moon doesn't hurt.
			return 1 - lit;
	}
}

function bortleSubScore(bortle: number): number {
	return 1 - ((bortle - 1) / 8) * 0.9; // Bortle 1 → 1.0, Bortle 9 → 0.1
}

function scoreNight(night: Night, target: Target, bortle: number): NightScore {
	const w = WEIGHTS[target];
	const cloudScore = night.avgCloud === null ? null : 1 - night.avgCloud / 100;
	const moonScore = moonSubScore(night, target);
	const bortleScore = bortleSubScore(bortle);

	let composite: number;
	if (cloudScore === null) {
		// Degraded mode: renormalize over the factors we still have.
		const total = w.moon + w.bortle;
		composite = (w.moon * moonScore + w.bortle * bortleScore) / total;
	} else {
		composite = w.cloud * cloudScore + w.moon * moonScore + w.bortle * bortleScore;
	}
	return { night, cloudScore, moonScore, bortleScore, composite };
}

// ------------------------------------------------------------ best window

function pickWindow(night: Night, target: Target, offsetSeconds: number): string {
	// Rate each dark hour, then take the best contiguous run of 2–4 hours.
	const astro = target === 'milky_way' || target === 'general' || target === 'planets';
	const rated = night.hours.map((h) => {
		let score = h.cloudCover === null ? 0.5 : 1 - h.cloudCover / 100;
		if (target === 'moon') score += h.moonUp ? 0.5 : -0.5;
		else if (astro) score += h.moonUp ? 0 : 0.3;
		return { hour: h, score };
	});

	let bestStart = 0;
	let bestLen = Math.min(2, rated.length);
	let bestAvg = -Infinity;
	for (let len = 2; len <= Math.min(4, rated.length); len++) {
		for (let start = 0; start + len <= rated.length; start++) {
			const slice = rated.slice(start, start + len);
			// Windows must be contiguous hours (dark hours can gap across dusk/dawn).
			const contiguous = slice.every(
				(r, i) =>
					i === 0 ||
					r.hour.time.getTime() - slice[i - 1]!.hour.time.getTime() === 3600000,
			);
			if (!contiguous) continue;
			const avg = slice.reduce((a, r) => a + r.score, 0) / len;
			// Prefer longer windows on ties (small epsilon bonus per hour).
			const adjusted = avg + len * 0.01;
			if (adjusted > bestAvg) {
				bestAvg = adjusted;
				bestStart = start;
				bestLen = len;
			}
		}
	}

	const first = rated[bestStart]!.hour.time;
	const last = rated[bestStart + bestLen - 1]!.hour.time;
	const end = new Date(last.getTime() + 3600000); // window closes at the end of the last hour
	return `${night.dateLabel}, ${formatLocalTime(first, offsetSeconds)}–${formatLocalTime(end, offsetSeconds)}`;
}

// ------------------------------------------------------------- confidence

const BLOCKING_THRESHOLD = 0.35;

interface FactorEntry {
	factor: string;
	weight: number;
	score: number;
}

/**
 * Base bands on the composite, then an explicit cap rule: a weighted sum can
 * hide one catastrophic factor behind two good ones, so any factor scoring
 * below the blocking threshold caps confidence — to `low` if it carries high
 * weight for this target, to `medium` if it carries medium weight. This keeps
 * "clear skies + new moon" in Manhattan from reading as a confident Milky Way
 * recommendation.
 */
function confidenceFor(
	composite: number,
	weatherOk: boolean,
	entries: FactorEntry[],
): Confidence {
	if (!weatherOk) return 'low';
	let confidence: Confidence =
		composite >= 0.7 ? 'high' : composite >= 0.4 ? 'medium' : 'low';
	for (const e of entries) {
		if (e.score >= BLOCKING_THRESHOLD) continue;
		if (weightLabel(e.weight) === 'high') confidence = 'low';
		else if (weightLabel(e.weight) === 'medium' && confidence === 'high') {
			confidence = 'medium';
		}
	}
	return confidence;
}

// ------------------------------------------------------------------ main

/**
 * Injectable dependencies — production callers pass nothing; the eval
 * harness injects fixture weather/geo/bortle to test reasoning under
 * controlled conditions (you can't order a full moon from a live API).
 */
export interface EngineDeps {
	resolve?: typeof resolveLocation;
	fetchWeather?: typeof fetchHourlyWeather;
	bortle?: typeof lookupBortle;
	now?: () => Date;
}

export async function planShootWindow(
	input: PlanInput,
	deps: EngineDeps = {},
): Promise<PlanResult> {
	const target: Target = input.target ?? 'general';
	const days = parseDateRange(input.date_range);

	const resolved = await (deps.resolve ?? resolveLocation)(input.location);
	const { latitude, longitude } = resolved;

	const sources: SourceStatus = {
		geocoding: resolved.geocoded ? 'ok' : 'skipped',
		weather: 'ok',
		moon: 'ok',
		light_pollution: 'ok',
	};

	let weather: HourlyWeather | null = null;
	try {
		weather = await (deps.fetchWeather ?? fetchHourlyWeather)(latitude, longitude, days);
	} catch {
		sources.weather = 'failed';
	}

	const bortle = (deps.bortle ?? lookupBortle)(latitude, longitude);
	const nights = buildNights(latitude, longitude, weather, days, deps.now ?? (() => new Date()));
	if (nights.length === 0) {
		throw new Error(
			'No usable dark hours found in the requested range at this location (polar summer?).',
		);
	}

	const scored = nights
		.map((n) => scoreNight(n, target, bortle.bortle))
		.sort((a, b) => b.composite - a.composite);
	const best = scored[0]!;
	const offsetSeconds =
		weather?.utcOffsetSeconds ?? Math.round(longitude / 15) * 3600;

	const weatherOk = sources.weather === 'ok';
	const w = WEIGHTS[target];

	const entries: FactorEntry[] = [
		{ factor: 'moon_phase', weight: w.moon, score: best.moonScore },
		{ factor: 'bortle_class', weight: w.bortle, score: best.bortleScore },
	];
	if (weatherOk && best.cloudScore !== null) {
		entries.push({ factor: 'cloud_cover', weight: w.cloud, score: best.cloudScore });
	}

	const confidence = confidenceFor(best.composite, weatherOk, entries);
	const bestWindow = pickWindow(best.night, target, offsetSeconds);

	// ---- evidence trail -------------------------------------------------
	const evidence: EvidenceItem[] = [];

	evidence.push({
		factor: 'moon_phase',
		value: `${best.night.moonPhaseName}, ${Math.round(best.night.moonIllumination * 100)}% illumination, up ${Math.round(best.night.moonUpFraction * 100)}% of dark hours`,
		weight: weightLabel(w.moon),
		source: 'calculated',
		score: round2(best.moonScore),
	});

	if (weatherOk && best.cloudScore !== null) {
		evidence.push({
			factor: 'cloud_cover',
			value: `${Math.round(best.night.avgCloud!)}% average during dark hours on the best night`,
			weight: weightLabel(w.cloud),
			source: 'open-meteo',
			score: round2(best.cloudScore),
		});
	} else {
		evidence.push({
			factor: 'cloud_cover',
			value: 'unavailable — weather API failed after retries; recommendation based on moon and light pollution alone',
			weight: weightLabel(w.cloud),
			source: 'open-meteo',
		});
	}

	evidence.push({
		factor: 'bortle_class',
		value: `${bortle.bortle} (${bortle.description}) — nearest reference: ${bortle.site}, ${bortle.distanceKm} km away`,
		weight: weightLabel(w.bortle),
		source: 'static dataset',
		score: round2(best.bortleScore),
	});

	markDominant(evidence, entries, confidence);

	const summary = buildSummary(best, target, confidence, weatherOk, evidence);

	return {
		recommendation: { best_window: bestWindow, confidence, summary },
		evidence,
		meta: {
			resolved_location: resolved.label,
			latitude,
			longitude,
			target,
			nights_considered: nights.length,
			sources,
		},
	};
}

// ------------------------------------------------------------- dominance

function markDominant(
	evidence: EvidenceItem[],
	entries: FactorEntry[],
	confidence: Confidence,
): void {
	// When the result is capped, the dominant factor is the biggest drag
	// (weight × shortfall); when it's strong, it's the biggest contributor.
	const capped = confidence !== 'high';
	const pick = entries.reduce((a, b) => {
		const va = capped ? a.weight * (1 - a.score) : a.weight * a.score;
		const vb = capped ? b.weight * (1 - b.score) : b.weight * b.score;
		return vb > va ? b : a;
	});

	for (const item of evidence) {
		if (item.factor === pick.factor) {
			item.dominant = true;
			if (capped && pick.score < BLOCKING_THRESHOLD) item.blocking = true;
		}
	}
}

function buildSummary(
	best: NightScore,
	target: Target,
	confidence: Confidence,
	weatherOk: boolean,
	evidence: EvidenceItem[],
): string {
	const dominant = evidence.find((e) => e.dominant);
	const targetLabel = target.replace('_', ' ');
	if (!weatherOk) {
		return `Weather data was unavailable, so this ${targetLabel} recommendation rests on moon and light-pollution evidence alone — treat it as a starting point, not a forecast.`;
	}
	if (confidence === 'high') {
		return `Strong ${targetLabel} conditions: the factors align, led by ${dominant?.factor.replace('_', ' ') ?? 'the evidence'} (${dominant?.value ?? ''}).`;
	}
	if (dominant?.blocking) {
		return `Conditions are limited for ${targetLabel}: ${dominant.factor.replace('_', ' ')} is the blocking factor (${dominant.value}).`;
	}
	return `Workable but imperfect ${targetLabel} conditions; ${dominant?.factor.replace('_', ' ') ?? 'multiple factors'} is the main constraint (${dominant?.value ?? ''}).`;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}
