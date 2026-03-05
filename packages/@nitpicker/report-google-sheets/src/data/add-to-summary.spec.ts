import { describe, it, expect } from 'vitest';

import { addToSummary } from './add-to-summary.js';

describe('addToSummary', () => {
	it('is a function', () => {
		expect(typeof addToSummary).toBe('function');
	});

	it('returns undefined (not yet implemented)', async () => {
		const result = await addToSummary();
		expect(result).toBeUndefined();
	});
});
