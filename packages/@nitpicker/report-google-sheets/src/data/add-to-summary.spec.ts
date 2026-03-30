import { describe, it, expect } from 'vitest';

import { addToSummary } from './add-to-summary.js';

describe('addToSummary', () => {
	it('returns undefined (no-op placeholder)', async () => {
		const result = await addToSummary();
		expect(result).toBeUndefined();
	});

	it('can be called without arguments', () => {
		expect(() => addToSummary()).not.toThrow();
	});
});
