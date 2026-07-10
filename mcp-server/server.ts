// One server, three consumers of the same core:
//   /mcp       — Streamable HTTP MCP endpoint (stateless, per-request transport)
//   /api/plan  — plain REST, same core logic
//   /          — demo web client (static)

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Hono } from 'hono';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { planShootWindow } from '../core/index.js';
import { buildMcpServer } from './mcp.js';
import { rateLimit } from './rate-limit.js';

const app = new Hono<{
	Bindings: { incoming: import('node:http').IncomingMessage; outgoing: import('node:http').ServerResponse };
}>();

// ---- REST ----------------------------------------------------------------

app.post('/api/plan', rateLimit(30, 5 * 60 * 1000), async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Request body must be JSON.' }, 400);
	}
	const { location, date_range, target } = (body ?? {}) as Record<string, unknown>;
	if (typeof location !== 'string' || location.trim() === '') {
		return c.json({ error: '"location" is required (city name or "lat,long").' }, 400);
	}
	if (target !== undefined && !['milky_way', 'moon', 'planets', 'general'].includes(target as string)) {
		return c.json({ error: '"target" must be one of milky_way, moon, planets, general.' }, 400);
	}
	try {
		const result = await planShootWindow({
			location,
			date_range: typeof date_range === 'string' ? date_range : undefined,
			target: target as never,
		});
		return c.json(result);
	} catch (err) {
		return c.json({ error: (err as Error).message }, 422);
	}
});

// ---- MCP (Streamable HTTP, stateless) --------------------------------------

app.all('/mcp', rateLimit(60, 5 * 60 * 1000), async (c) => {
	const { incoming, outgoing } = c.env;

	// Stateless mode: a fresh server+transport pair per request. No session
	// bookkeeping, horizontally scalable, and plenty for a single-tool server.
	const mcpServer = buildMcpServer();
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	await mcpServer.connect(transport);

	const body =
		c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
	await transport.handleRequest(incoming, outgoing, body);

	// The transport wrote directly to the node response.
	return RESPONSE_ALREADY_SENT;
});

// ---- Health + demo client --------------------------------------------------

app.get('/healthz', (c) => c.json({ ok: true }));

app.use('/*', serveStatic({ root: './demo-client' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
	console.log(JSON.stringify({ msg: 'listening', port: info.port }));
});
