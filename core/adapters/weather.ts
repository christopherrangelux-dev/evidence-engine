// Hourly forecast from Open-Meteo — free, no API key. Cloud cover is the
// scoring input; humidity and wind ride along as informational evidence.

import type { HourlyWeather } from '../types.js';
import { fetchJsonWithRetry } from './http.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

interface ForecastResponse {
	utc_offset_seconds: number;
	hourly: {
		time: string[]; // local ISO, no offset suffix
		cloud_cover: number[];
		relative_humidity_2m: number[];
		wind_speed_10m: number[];
	};
}

export async function fetchHourlyWeather(
	latitude: number,
	longitude: number,
	days: number,
): Promise<HourlyWeather> {
	const params = new URLSearchParams({
		latitude: String(latitude),
		longitude: String(longitude),
		hourly: 'cloud_cover,relative_humidity_2m,wind_speed_10m',
		forecast_days: String(Math.min(Math.max(days, 1), 16)),
		timezone: 'auto',
	});
	const data = await fetchJsonWithRetry<ForecastResponse>(`${FORECAST_URL}?${params}`);

	const offset = data.utc_offset_seconds;
	// API returns local wall-clock ISO strings; convert to true UTC instants.
	const times = data.hourly.time.map((t) => new Date(Date.parse(`${t}:00Z`) - offset * 1000));

	return {
		times,
		cloudCover: data.hourly.cloud_cover,
		humidity: data.hourly.relative_humidity_2m,
		windSpeed: data.hourly.wind_speed_10m,
		utcOffsetSeconds: offset,
	};
}
