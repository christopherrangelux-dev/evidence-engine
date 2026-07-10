// Minimal in-memory fixed-window rate limiter, keyed by client IP.
// Deliberately simple: one process, no external store — enough to keep the
// free-tier deployment from being hammered, not a distributed system.

import type { MiddlewareHandler } from 'hono';

interface Window {
	count: number;
	resetAt: number;
}

export function rateLimit(maxRequests: number, windowMs: number): MiddlewareHandler {
	const windows = new Map<string, Window>();

	return async (c, next) => {
		const ip =
			c.req.header('fly-client-ip') ??
			c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
			'unknown';
		const now = Date.now();

		let win = windows.get(ip);
		if (!win || now >= win.resetAt) {
			win = { count: 0, resetAt: now + windowMs };
			windows.set(ip, win);
		}
		win.count++;

		// Opportunistic cleanup so the map can't grow unbounded.
		if (windows.size > 10_000) {
			for (const [key, w] of windows) if (now >= w.resetAt) windows.delete(key);
		}

		if (win.count > maxRequests) {
			c.header('Retry-After', String(Math.ceil((win.resetAt - now) / 1000)));
			return c.json({ error: 'Rate limit exceeded — try again shortly.' }, 429);
		}
		await next();
	};
}
