// Eval harness for the Night Window engine.
//
// Runs each scenario in scenarios.ts against /core directly (no transport),
// and checks three things the reasoning must get right:
//   1. confidence lands in the expected band,
//   2. the evidence trail marks the expected factor as `dominant`,
//   3. that factor is (or isn't) flagged `blocking` as expected.
//
// Prints a pass/fail table and exits non-zero if any scenario fails, so it
// can gate a deploy. `runEvals()` is exported so the demo site can surface
// the same report at a future /evals route — the report is itself evidence
// that the tool reasons well, not just that it runs.

import { planShootWindow } from '../core/engine.js';
import type { EvidenceItem, PlanResult } from '../core/types.js';
import { scenarios, type Scenario } from './scenarios.js';

interface Check {
	label: string;
	pass: boolean;
	detail: string;
}

export interface EvalResult {
	name: string;
	expectation: string;
	pass: boolean;
	confidence: string;
	bestWindow: string;
	summary: string;
	checks: Check[];
	error?: string;
}

function dominantOf(evidence: EvidenceItem[]): EvidenceItem | undefined {
	return evidence.find((e) => e.dominant);
}

function evaluate(scenario: Scenario, result: PlanResult): Check[] {
	const { recommendation, evidence } = result;
	const dominant = dominantOf(evidence);

	return [
		{
			label: 'confidence',
			pass: scenario.expectConfidence.includes(recommendation.confidence),
			detail: `got "${recommendation.confidence}", expected ${scenario.expectConfidence
				.map((c) => `"${c}"`)
				.join(' | ')}`,
		},
		{
			label: 'dominant factor',
			pass: dominant?.factor === scenario.expectDominant,
			detail: `got "${dominant?.factor ?? 'none'}", expected "${scenario.expectDominant}"`,
		},
		{
			label: 'blocking flag',
			pass: Boolean(dominant?.blocking) === scenario.expectBlocking,
			detail: `got ${Boolean(dominant?.blocking)}, expected ${scenario.expectBlocking}`,
		},
	];
}

export async function runEvals(): Promise<EvalResult[]> {
	const results: EvalResult[] = [];
	for (const scenario of scenarios) {
		try {
			const result = await planShootWindow(scenario.input, scenario.deps);
			const checks = evaluate(scenario, result);
			results.push({
				name: scenario.name,
				expectation: scenario.expectation,
				pass: checks.every((c) => c.pass),
				confidence: result.recommendation.confidence,
				bestWindow: result.recommendation.best_window,
				summary: result.recommendation.summary,
				checks,
			});
		} catch (err) {
			results.push({
				name: scenario.name,
				expectation: scenario.expectation,
				pass: false,
				confidence: '—',
				bestWindow: '—',
				summary: '—',
				checks: [],
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	return results;
}

// ------------------------------------------------------------- CLI reporter

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function printReport(results: EvalResult[]): void {
	console.log(`\n${BOLD}Night Window — reasoning evals${RESET}\n`);

	for (const r of results) {
		const badge = r.pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
		console.log(`${badge}  ${BOLD}${r.name}${RESET}`);
		console.log(`      ${DIM}${r.expectation}${RESET}`);
		if (r.error) {
			console.log(`      ${RED}error: ${r.error}${RESET}`);
		} else {
			console.log(
				`      ${DIM}→ ${r.confidence} confidence · ${r.bestWindow}${RESET}`,
			);
			for (const c of r.checks) {
				const mark = c.pass ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
				console.log(`      ${mark} ${c.label}: ${c.detail}`);
			}
		}
		console.log('');
	}

	const passed = results.filter((r) => r.pass).length;
	const total = results.length;
	const allPass = passed === total;
	const summaryColor = allPass ? GREEN : RED;
	console.log(
		`${summaryColor}${BOLD}${passed}/${total} scenarios passed${RESET}\n`,
	);
}

// Run as a script (npm run evals). Skipped when imported as a module.
const isMain =
	process.argv[1] !== undefined &&
	import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
	runEvals().then((results) => {
		printReport(results);
		process.exit(results.every((r) => r.pass) ? 0 : 1);
	});
}
