// Shared types for the Evidence Engine core. Pure data — no transport concerns.

export type Target = 'milky_way' | 'moon' | 'planets' | 'general';

export type Confidence = 'high' | 'medium' | 'low';

export type WeightLabel = 'high' | 'medium' | 'low';

export type EvidenceSource = 'calculated' | 'open-meteo' | 'static dataset';

export interface EvidenceItem {
	factor: string;
	value: string;
	weight: WeightLabel;
	source: EvidenceSource;
	/** Normalized 0..1 sub-score this factor contributed (omitted for informational items). */
	score?: number;
	/** True on the factor that most drove — or most capped — the recommendation. */
	dominant?: boolean;
	/** Set when this factor alone is bad enough to undermine the whole window. */
	blocking?: boolean;
}

export interface Recommendation {
	best_window: string;
	confidence: Confidence;
	/** One-sentence human summary of why. */
	summary: string;
}

export interface SourceStatus {
	geocoding: 'ok' | 'skipped' | 'failed';
	weather: 'ok' | 'failed';
	moon: 'ok';
	light_pollution: 'ok';
}

export interface PlanInput {
	location: string;
	date_range?: string;
	target?: Target;
}

export interface PlanResult {
	recommendation: Recommendation;
	evidence: EvidenceItem[];
	meta: {
		resolved_location: string;
		latitude: number;
		longitude: number;
		target: Target;
		nights_considered: number;
		sources: SourceStatus;
	};
}

export interface ResolvedLocation {
	latitude: number;
	longitude: number;
	label: string;
	geocoded: boolean;
}

export interface HourlyWeather {
	/** UTC timestamps, one per hour. */
	times: Date[];
	cloudCover: number[]; // percent
	humidity: number[]; // percent
	windSpeed: number[]; // km/h
	utcOffsetSeconds: number;
}

export interface BortleMatch {
	site: string;
	bortle: number;
	distanceKm: number;
	description: string;
}
