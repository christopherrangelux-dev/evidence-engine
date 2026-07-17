// Moon-math ground-truth tests. The phase/illumination math is a truncated
// Meeus series (moon.ts) — cheap to get subtly wrong, and easy to pin down:
// new/full moon dates are public, verifiable astronomical fact. These assert
// the engine agrees with known 2026 lunar dates (illumination confirmed
// against published ephemerides), so a regression in the series shows up here
// rather than as quietly wrong shoot recommendations.

import { describe, it, expect } from 'vitest';
import { moonState, SYNODIC_MONTH } from './moon.js';

// Illumination and phase are location-independent; a fixed observer is only
// needed for the altitude field. Sample at 08:00 UTC (~local midnight, US west).
const LAT = 36.5;
const LON = -117.0;
function at(dateIso: string) {
	return moonState(new Date(`${dateIso}T08:00:00Z`), LAT, LON);
}

// Real 2026 lunar dates.
const NEW_MOONS = ['2026-01-19', '2026-02-17', '2026-07-14', '2026-09-11'];
const FULL_MOONS = ['2026-01-03', '2026-03-03', '2026-07-29', '2026-08-28'];

describe('moon phase against known 2026 dates', () => {
	it.each(NEW_MOONS)('reads %s as a new moon (near-zero illumination)', (date) => {
		const m = at(date);
		expect(m.illumination).toBeLessThan(0.05);
		expect(m.phaseName).toBe('new moon');
	});

	it.each(FULL_MOONS)('reads %s as a full moon (near-full illumination)', (date) => {
		const m = at(date);
		expect(m.illumination).toBeGreaterThan(0.95);
		expect(m.phaseName).toBe('full moon');
	});

	it('illumination rises monotonically across a waxing half-cycle', () => {
		// New (Jul 14) → first quarter (~Jul 22) → full (Jul 29).
		const newMoon = at('2026-07-14').illumination;
		const quarter = at('2026-07-22').illumination;
		const full = at('2026-07-29').illumination;
		expect(newMoon).toBeLessThan(quarter);
		expect(quarter).toBeLessThan(full);
		expect(quarter).toBeGreaterThan(0.3);
		expect(quarter).toBeLessThan(0.7); // near half-lit at first quarter
	});
});

describe('moon state stays within physical bounds', () => {
	// Walk a full synodic month at daily steps.
	const samples = Array.from({ length: 30 }, (_, i) => {
		const d = new Date(Date.UTC(2026, 6, 1, 8, 0, 0) + i * 86400000);
		return moonState(d, LAT, LON);
	});

	it('illumination is always a fraction in [0, 1]', () => {
		for (const m of samples) {
			expect(m.illumination).toBeGreaterThanOrEqual(0);
			expect(m.illumination).toBeLessThanOrEqual(1);
		}
	});

	it('age is within a synodic month', () => {
		for (const m of samples) {
			expect(m.age).toBeGreaterThanOrEqual(0);
			expect(m.age).toBeLessThanOrEqual(SYNODIC_MONTH);
		}
	});

	it('altitude is a valid elevation angle', () => {
		for (const m of samples) {
			expect(m.altitude).toBeGreaterThanOrEqual(-90);
			expect(m.altitude).toBeLessThanOrEqual(90);
		}
	});
});
