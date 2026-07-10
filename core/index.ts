// Public surface of the core engine. Transports import from here only.

export { planShootWindow, parseDateRange } from './engine.js';
export type { EngineDeps } from './engine.js';
export { moonState } from './astronomy/moon.js';
export { sunAltitude } from './astronomy/sun.js';
export { lookupBortle } from './adapters/bortle.js';
export type {
	PlanInput,
	PlanResult,
	EvidenceItem,
	Recommendation,
	Target,
	Confidence,
} from './types.js';
