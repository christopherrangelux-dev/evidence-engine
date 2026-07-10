// MCP wrapper around the core engine. Deliberately thin: the protocol is a
// transport, not the product — everything interesting lives in /core.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { planShootWindow } from '../core/index.js';

export function buildMcpServer(): McpServer {
	const server = new McpServer({
		name: 'evidence-engine',
		version: '0.1.0',
	});

	server.registerTool(
		'plan_shoot_window',
		{
			title: 'Night Window — astrophotography shoot planner',
			description:
				'Recommends optimal astrophotography shoot windows with reasoning. ' +
				'Returns a recommendation plus the weighted evidence trail that produced it: ' +
				'moon phase (calculated), cloud cover (Open-Meteo forecast), and light ' +
				'pollution (Bortle class from a curated dataset).',
			inputSchema: {
				location: z
					.string()
					.describe('City name or "lat,long" coordinates'),
				date_range: z
					.string()
					.optional()
					.describe('e.g. "next 7 days", "tonight" (default: next 7 days)'),
				target: z
					.enum(['milky_way', 'moon', 'planets', 'general'])
					.optional()
					.describe('What you want to shoot (default: general)'),
			},
		},
		async (args) => {
			try {
				const result = await planShootWindow(args);
				return {
					content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ error: (err as Error).message }, null, 2),
						},
					],
					isError: true,
				};
			}
		},
	);

	return server;
}
