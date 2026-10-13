import { describe, it, expect } from 'vitest';

import { TEMPLATE_CORPUS_INLINE_THRESHOLD } from './template-corpus-inline-threshold.js';

describe('TEMPLATE_CORPUS_INLINE_THRESHOLD', () => {
	it('is the corpus size above which a run streams', () => {
		expect(TEMPLATE_CORPUS_INLINE_THRESHOLD).toBe(20_000);
	});
});
