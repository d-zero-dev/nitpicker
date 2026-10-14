import { describe, it, expect } from 'vitest';

import { TEMPLATE_BLOCK_SAMPLE_SIZE } from './template-block-sample-size.js';

describe('TEMPLATE_BLOCK_SAMPLE_SIZE', () => {
	it('is the number of pages per sampled block a run clusters', () => {
		expect(TEMPLATE_BLOCK_SAMPLE_SIZE).toBe(100);
	});
});
