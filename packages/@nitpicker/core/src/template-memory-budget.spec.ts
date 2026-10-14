import { describe, it, expect } from 'vitest';

import { TEMPLATE_MEMORY_BUDGET } from './template-memory-budget.js';

describe('TEMPLATE_MEMORY_BUDGET', () => {
	it('is the bytes a block similarity table may take before the block is sampled', () => {
		expect(TEMPLATE_MEMORY_BUDGET).toBe(536_870_912);
	});
});
