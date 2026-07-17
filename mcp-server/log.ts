// Structured JSON logging — one line per event, so logs stay greppable and
// machine-parseable once this is running on Fly (fly logs streams stdout).
// No logging framework: a single stdout writer is enough for one process.

type Level = 'info' | 'warn' | 'error';

interface LogFields {
	[key: string]: unknown;
}

export function log(level: Level, event: string, fields: LogFields = {}): void {
	const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
	if (level === 'error') console.error(line);
	else console.log(line);
}

import type { PlanInput, PlanResult } from '../core/types.js';

/**
 * Run a plan and emit exactly one structured log line describing the call —
 * request id, inputs, latency, which data sources succeeded/failed, and the
 * confidence it landed on (or the error). Both transports (`/api/plan` and
 * `/mcp`) wrap their engine call in this so the tool-call log is uniform
 * regardless of how the request arrived.
 */
export async function loggedPlan(
	route: string,
	input: PlanInput,
	run: (input: PlanInput) => Promise<PlanResult>,
): Promise<PlanResult> {
	const requestId = crypto.randomUUID();
	const started = performance.now();
	try {
		const result = await run(input);
		log('info', 'tool_call', {
			tool: 'plan_shoot_window',
			request_id: requestId,
			route,
			input,
			latency_ms: Math.round(performance.now() - started),
			sources: result.meta.sources,
			confidence: result.recommendation.confidence,
		});
		return result;
	} catch (err) {
		log('error', 'tool_call', {
			tool: 'plan_shoot_window',
			request_id: requestId,
			route,
			input,
			latency_ms: Math.round(performance.now() - started),
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	}
}
