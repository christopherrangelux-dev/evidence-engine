// Light pollution via a static curated dataset — the one deliberate
// simplification in this build (documented in the README). Nearest-match
// lookup over known dark-sky sites and major metros. Path to a live
// VIIRS-based lookup exists but is explicitly out of weekend scope.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BortleMatch } from '../types.js';

interface Site {
	name: string;
	lat: number;
	lon: number;
	bortle: number;
}

const BORTLE_DESCRIPTIONS: Record<number, string> = {
	1: 'excellent dark-sky site',
	2: 'truly dark site',
	3: 'rural sky',
	4: 'rural/suburban transition',
	5: 'suburban sky',
	6: 'bright suburban sky',
	7: 'suburban/urban transition',
	8: 'city sky',
	9: 'inner-city sky',
};

let sites: Site[] | null = null;

function loadSites(): Site[] {
	if (sites) return sites;
	const csvPath = fileURLToPath(new URL('../data/bortle-sites.csv', import.meta.url));
	const lines = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1); // drop header
	sites = lines.map((line) => {
		const parts = line.split(',');
		const bortle = Number(parts.pop());
		const lon = Number(parts.pop());
		const lat = Number(parts.pop());
		return { name: parts.join(','), lat, lon, bortle };
	});
	return sites;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371;
	const rad = Math.PI / 180;
	const dLat = (lat2 - lat1) * rad;
	const dLon = (lon2 - lon1) * rad;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

export function lookupBortle(latitude: number, longitude: number): BortleMatch {
	let best: Site | null = null;
	let bestDist = Infinity;
	for (const site of loadSites()) {
		const d = haversineKm(latitude, longitude, site.lat, site.lon);
		if (d < bestDist) {
			bestDist = d;
			best = site;
		}
	}
	// loadSites() always returns a non-empty curated list.
	const site = best!;
	return {
		site: site.name,
		bortle: site.bortle,
		distanceKm: Math.round(bestDist),
		description: BORTLE_DESCRIPTIONS[site.bortle] ?? 'unknown',
	};
}
