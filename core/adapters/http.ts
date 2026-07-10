// Shared HTTP plumbing: timeout + retry with backoff. Both external calls
// (geocoding, weather) go through here so degradation behavior is uniform.

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRIES = 2;

export async function fetchJsonWithRetry<T>(
	url: string,
	{ timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {},
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(url, { signal: controller.signal });
			if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
			return (await res.json()) as T;
		} catch (err) {
			lastError = err;
			if (attempt < retries) {
				await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
			}
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
