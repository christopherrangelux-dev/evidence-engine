// Eval scenarios for the Night Window reasoning engine.
//
// The engine is transport-agnostic and takes an injectable `EngineDeps` seam
// (see core/engine.ts). That seam is what makes these evals possible: you
// can't order a full moon or a heavy cloud forecast from a live API, so we
// inject fixture weather, geocoding, and Bortle class and drive /core
// directly. The one input we *don't* fake is the moon — phase and altitude
// are calculated from the date, so each scenario is anchored to a real 2026
// new/full moon date (verified against the engine's own Meeus math), and the
// fixtures only control the sky conditions around it.

import type { EngineDeps } from '../core/engine.js';
import type {
	BortleMatch,
	HourlyWeather,
	PlanInput,
	ResolvedLocation,
} from '../core/types.js';

// Real 2026 lunar dates (illumination confirmed via core/astronomy/moon.ts):
//   2026-07-29 → full moon (99.9% illuminated)
//   2026-07-14 → new moon  ( 0.1% illuminated)
const FULL_MOON = Date.UTC(2026, 6, 29, 0, 0, 0);
const NEW_MOON = Date.UTC(2026, 6, 14, 0, 0, 0);
const HOURS = 72; // three nights of fixture data centered on the anchor date

/**
 * Build a fixture forecast: `HOURS` consecutive hourly samples from `anchorMs`,
 * all at a constant cloud cover. Humidity/wind are informational only, so they
 * carry plausible constants. The engine walks these times to find dark hours.
 */
function fixtureWeather(anchorMs: number, cloudPct: number): HourlyWeather {
	const times: Date[] = [];
	const cloudCover: number[] = [];
	for (let i = 0; i < HOURS; i++) {
		times.push(new Date(anchorMs + i * 3600000));
		cloudCover.push(cloudPct);
	}
	return {
		times,
		cloudCover,
		humidity: cloudCover.map(() => 45),
		windSpeed: cloudCover.map(() => 6),
		utcOffsetSeconds: -25200, // US mountain/pacific summer; affects labels only
	};
}

function fixedLocation(latitude: number, longitude: number, label: string): ResolvedLocation {
	return { latitude, longitude, label, geocoded: true };
}

function fixedBortle(bortle: number, site: string, description: string): BortleMatch {
	return { site, bortle, distanceKm: 0, description };
}

/** Assemble an EngineDeps that fully controls every input except moon math. */
function deps(
	location: ResolvedLocation,
	weather: HourlyWeather,
	bortle: BortleMatch,
): EngineDeps {
	return {
		resolve: async () => location,
		fetchWeather: async () => weather,
		bortle: () => bortle,
	};
}

export interface Scenario {
	name: string;
	/** What a human should expect the reasoning to conclude. */
	expectation: string;
	input: PlanInput;
	deps: EngineDeps;
	/** Confidence bands considered a pass (the engine emits high/medium/low). */
	expectConfidence: Array<'high' | 'medium' | 'low'>;
	/** Factor the evidence trail must mark as `dominant`. */
	expectDominant: string;
	/** Whether that dominant factor must also be flagged `blocking`. */
	expectBlocking: boolean;
}

// Shared fixture locations.
const DEATH_VALLEY = fixedLocation(36.505, -117.079, 'Death Valley National Park (fixture)');
const DARK_SITE = fixedLocation(38.0, -110.0, 'Bortle 3 rural site (fixture)');
const MANHATTAN = fixedLocation(40.783, -73.971, 'Manhattan, NY (fixture)');

const BORTLE_2 = fixedBortle(2, 'Death Valley', 'truly dark site');
const BORTLE_3 = fixedBortle(3, 'rural reference', 'rural sky');
const BORTLE_8 = fixedBortle(8, 'inner metro', 'city sky');

export const scenarios: Scenario[] = [
	{
		name: 'Full moon, clear skies — Milky Way',
		expectation:
			'A bright full moon washes out the Milky Way even under perfect skies; moon should block confidence down.',
		input: { location: 'Death Valley', target: 'milky_way', date_range: '3 nights' },
		deps: deps(DEATH_VALLEY, fixtureWeather(FULL_MOON, 5), BORTLE_2),
		expectConfidence: ['low'],
		expectDominant: 'moon_phase',
		expectBlocking: true,
	},
	{
		name: 'Full moon, clear skies — Moon target',
		expectation:
			'The same full moon that ruins the Milky Way is ideal for shooting the moon itself: bright, up, clear.',
		input: { location: 'Death Valley', target: 'moon', date_range: '3 nights' },
		deps: deps(DEATH_VALLEY, fixtureWeather(FULL_MOON, 5), BORTLE_2),
		expectConfidence: ['high'],
		// The target flip is the point: the full moon that *blocked* the Milky
		// Way is no longer a blocker here (blocking:false, high confidence). With
		// clear skies the top positive contributor is cloud_cover (weight 0.5),
		// which correctly out-weights the moon's own strong score (weight 0.4).
		expectDominant: 'cloud_cover',
		expectBlocking: false,
	},
	{
		name: 'New moon, heavy cloud — Milky Way',
		expectation:
			'A perfect new moon is useless under a 90% overcast forecast; cloud cover should be the blocking factor.',
		input: { location: 'Death Valley', target: 'milky_way', date_range: '3 nights' },
		deps: deps(DEATH_VALLEY, fixtureWeather(NEW_MOON, 90), BORTLE_2),
		expectConfidence: ['low'],
		expectDominant: 'cloud_cover',
		expectBlocking: true,
	},
	{
		name: 'New moon, clear, dark sky — Milky Way',
		expectation:
			'New moon + clear skies + a genuinely dark site: all three factors align, this is the ideal case.',
		input: { location: 'Bortle 3 site', target: 'milky_way', date_range: '3 nights' },
		deps: deps(DARK_SITE, fixtureWeather(NEW_MOON, 5), BORTLE_3),
		expectConfidence: ['high'],
		expectDominant: 'cloud_cover', // strongest positive contributor (highest weight, ~1.0)
		expectBlocking: false,
	},
	{
		name: 'Urban Bortle 8, otherwise perfect — Milky Way',
		expectation:
			'Even with a new moon and clear skies, inner-city light pollution caps a Milky Way shoot; Bortle should be flagged regardless of weather/moon.',
		input: { location: 'Manhattan', target: 'milky_way', date_range: '3 nights' },
		deps: deps(MANHATTAN, fixtureWeather(NEW_MOON, 5), BORTLE_8),
		expectConfidence: ['medium', 'low'],
		expectDominant: 'bortle_class',
		expectBlocking: true,
	},
];
