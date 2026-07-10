// Solar position — enough precision to find astronomical darkness windows.
// Standard low-precision algorithm (Meeus, Astronomical Algorithms ch. 25),
// good to well under a degree, which is far tighter than we need for
// "is the sun below -12°/-18°?"

const DEG = Math.PI / 180;

export function julianDate(date: Date): number {
	return date.getTime() / 86400000 + 2440587.5;
}

/** Normalize an angle in degrees to [0, 360). */
export function norm360(deg: number): number {
	const d = deg % 360;
	return d < 0 ? d + 360 : d;
}

export interface EquatorialCoords {
	rightAscension: number; // degrees
	declination: number; // degrees
}

/** Sun's apparent ecliptic longitude in degrees, plus equatorial coords. */
export function sunPosition(date: Date): EquatorialCoords & { eclipticLongitude: number } {
	const T = (julianDate(date) - 2451545.0) / 36525;

	const L0 = norm360(280.46646 + 36000.76983 * T);
	const M = norm360(357.52911 + 35999.05029 * T);
	const C =
		(1.914602 - 0.004817 * T) * Math.sin(M * DEG) +
		(0.019993 - 0.000101 * T) * Math.sin(2 * M * DEG) +
		0.000289 * Math.sin(3 * M * DEG);
	const trueLongitude = norm360(L0 + C);

	const epsilon = 23.439291 - 0.0130042 * T; // mean obliquity
	const lambda = trueLongitude * DEG;
	const eps = epsilon * DEG;

	const rightAscension = norm360(
		Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / DEG,
	);
	const declination = Math.asin(Math.sin(eps) * Math.sin(lambda)) / DEG;

	return { rightAscension, declination, eclipticLongitude: trueLongitude };
}

/** Local sidereal time in degrees at the given instant and east longitude. */
export function localSiderealTime(date: Date, longitude: number): number {
	const d = julianDate(date) - 2451545.0;
	return norm360(280.46061837 + 360.98564736629 * d + longitude);
}

/** Altitude in degrees of an equatorial position from a ground observer. */
export function altitudeOf(
	coords: EquatorialCoords,
	date: Date,
	latitude: number,
	longitude: number,
): number {
	const lst = localSiderealTime(date, longitude);
	const H = norm360(lst - coords.rightAscension) * DEG;
	const phi = latitude * DEG;
	const dec = coords.declination * DEG;
	return (
		Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / DEG
	);
}

/** Sun altitude in degrees. Negative = below horizon. */
export function sunAltitude(date: Date, latitude: number, longitude: number): number {
	return altitudeOf(sunPosition(date), date, latitude, longitude);
}
