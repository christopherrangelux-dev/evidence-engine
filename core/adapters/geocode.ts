// Location resolution. "lat,long" strings pass through untouched; anything
// else goes to Open-Meteo's free geocoding endpoint (no API key).

import type { ResolvedLocation } from '../types.js';
import { fetchJsonWithRetry } from './http.js';

const LATLONG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

interface GeocodeResponse {
	results?: Array<{
		name: string;
		latitude: number;
		longitude: number;
		country?: string;
		admin1?: string;
	}>;
}

export async function resolveLocation(location: string): Promise<ResolvedLocation> {
	const match = location.match(LATLONG_RE);
	if (match) {
		const latitude = Number(match[1]);
		const longitude = Number(match[2]);
		if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
			throw new Error(`Coordinates out of range: ${location}`);
		}
		return { latitude, longitude, label: `${latitude}, ${longitude}`, geocoded: false };
	}

	const url = `${GEOCODE_URL}?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
	const data = await fetchJsonWithRetry<GeocodeResponse>(url);
	const hit = data.results?.[0];
	if (!hit) {
		throw new Error(`Could not resolve location "${location}" — try a larger city or "lat,long".`);
	}
	const region = [hit.admin1, hit.country].filter(Boolean).join(', ');
	return {
		latitude: hit.latitude,
		longitude: hit.longitude,
		label: region ? `${hit.name} (${region})` : hit.name,
		geocoded: true,
	};
}
