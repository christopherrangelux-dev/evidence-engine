// Lunar position, phase, and illumination — calculated, not fetched.
// Truncated Meeus ch. 47 series: a handful of the largest periodic terms,
// giving longitude to ~0.05° and illumination to well under 1% — plenty for
// shoot planning, and verifiable against known new/full moon dates.

import { julianDate, norm360, altitudeOf, sunPosition } from './sun.js';

const DEG = Math.PI / 180;
export const SYNODIC_MONTH = 29.530588853; // days

interface MoonEcliptic {
	longitude: number; // degrees
	latitude: number; // degrees
}

function moonEcliptic(date: Date): MoonEcliptic {
	const T = (julianDate(date) - 2451545.0) / 36525;

	// Fundamental arguments (degrees)
	const Lp = norm360(218.3164477 + 481267.88123421 * T); // mean longitude
	const D = norm360(297.8501921 + 445267.1114034 * T); // mean elongation
	const M = norm360(357.5291092 + 35999.0502909 * T); // sun mean anomaly
	const Mp = norm360(134.9633964 + 477198.8675055 * T); // moon mean anomaly
	const F = norm360(93.272095 + 483202.0175233 * T); // argument of latitude

	const s = (x: number) => Math.sin(x * DEG);

	// Largest longitude terms (degrees)
	const longitude = norm360(
		Lp +
			6.288774 * s(Mp) +
			1.274027 * s(2 * D - Mp) +
			0.658314 * s(2 * D) +
			0.213618 * s(2 * Mp) -
			0.185116 * s(M) -
			0.114332 * s(2 * F) +
			0.058793 * s(2 * D - 2 * Mp) +
			0.057066 * s(2 * D - M - Mp) +
			0.053322 * s(2 * D + Mp) +
			0.045758 * s(2 * D - M),
	);

	// Largest latitude terms (degrees)
	const latitude =
		5.128122 * s(F) +
		0.280602 * s(Mp + F) +
		0.277693 * s(Mp - F) +
		0.173237 * s(2 * D - F);

	return { longitude, latitude };
}

export interface MoonState {
	/** Fraction illuminated, 0..1. */
	illumination: number;
	/** Days since new moon, 0..29.53. */
	age: number;
	/** Human name: "waning crescent" etc. */
	phaseName: string;
	/** Altitude above horizon in degrees at the given time/place. */
	altitude: number;
}

function phaseName(age: number, waxing: boolean): string {
	const frac = age / SYNODIC_MONTH;
	if (frac < 0.034 || frac > 0.966) return 'new moon';
	if (Math.abs(frac - 0.5) < 0.034) return 'full moon';
	if (Math.abs(frac - 0.25) < 0.034) return 'first quarter';
	if (Math.abs(frac - 0.75) < 0.034) return 'last quarter';
	if (frac < 0.25) return 'waxing crescent';
	if (frac < 0.5) return 'waxing gibbous';
	if (frac < 0.75) return 'waning gibbous';
	return 'waning crescent';
	// `waxing` kept for future use if age bins are replaced with a
	// longitude-rate check; the age fraction already encodes direction.
	void waxing;
}

export function moonState(date: Date, latitude: number, longitude: number): MoonState {
	const moon = moonEcliptic(date);
	const sun = sunPosition(date);

	// Elongation between moon and sun on the sky.
	const dLon = (moon.longitude - sun.eclipticLongitude) * DEG;
	const beta = moon.latitude * DEG;
	const cosElongation = Math.cos(beta) * Math.cos(dLon);
	// Phase angle ~ 180° − elongation (ignoring distance terms; <2% error).
	const illumination = (1 - cosElongation) / 2;

	// Age from the moon–sun longitude difference.
	const elongDeg = norm360(moon.longitude - sun.eclipticLongitude);
	const age = (elongDeg / 360) * SYNODIC_MONTH;

	// Equatorial coords for altitude.
	const T = (julianDate(date) - 2451545.0) / 36525;
	const eps = (23.439291 - 0.0130042 * T) * DEG;
	const lam = moon.longitude * DEG;
	const bet = beta;
	const ra = norm360(
		Math.atan2(
			Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps),
			Math.cos(lam),
		) / DEG,
	);
	const dec =
		Math.asin(
			Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam),
		) / DEG;

	const altitude = altitudeOf({ rightAscension: ra, declination: dec }, date, latitude, longitude);

	return {
		illumination,
		age,
		phaseName: phaseName(age, age < SYNODIC_MONTH / 2),
		altitude,
	};
}
