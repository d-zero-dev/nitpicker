import { describe, expect, it } from 'vitest';

import { SETUP_RECOVERY_PHASE_LABELS } from './setup-recovery-phase-labels.js';

describe('SETUP_RECOVERY_PHASE_LABELS', () => {
	it('lists exactly the two failure-only labels — guards against accidental drift', () => {
		// The CLI's setup task list treats any `onPhase` label in this set as
		// unplanned and splices in a row for it via `ctx.insertNext` — a new
		// entry here without a matching CLI-side handler would silently fall
		// back to being treated as a normal, planned-sequence label instead.
		expect(SETUP_RECOVERY_PHASE_LABELS).toEqual([
			'Restoring archive from backup',
			'Persisting ingested inventory state',
		]);
	});
});
