import { describe, expect, it } from 'vitest';

import { shouldRefuseStaleReadModel } from './should-refuse-stale-read-model.js';

describe('shouldRefuseStaleReadModel', () => {
	it('refuses when the read model is stale outside stub mode', () => {
		expect(shouldRefuseStaleReadModel('archive', false)).toBe(true);
	});

	it('never refuses in stub mode — the read model cannot exist there by construction', () => {
		expect(shouldRefuseStaleReadModel('stub', false)).toBe(false);
	});

	it('never refuses when the read model is current', () => {
		expect(shouldRefuseStaleReadModel('archive', true)).toBe(false);
		expect(shouldRefuseStaleReadModel('stub', true)).toBe(false);
	});
});
