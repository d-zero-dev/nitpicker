import { describe, expect, it } from 'vitest';

import { buildHeaderChecksFilterKey } from './build-header-checks-filter-key.js';

describe('buildHeaderChecksFilterKey', () => {
	it('produces the same key for an empty options object and every filter explicitly undefined', () => {
		expect(buildHeaderChecksFilterKey({})).toBe(
			buildHeaderChecksFilterKey({
				missingOnly: undefined,
				hasCSP: undefined,
				hasXFrameOptions: undefined,
				hasXContentTypeOptions: undefined,
				hasHSTS: undefined,
			}),
		);
	});

	it('produces a different key when missingOnly is set vs unset', () => {
		expect(buildHeaderChecksFilterKey({})).not.toBe(
			buildHeaderChecksFilterKey({ missingOnly: true }),
		);
	});

	it('produces a different key for different hasCSP values', () => {
		expect(buildHeaderChecksFilterKey({ hasCSP: true })).not.toBe(
			buildHeaderChecksFilterKey({ hasCSP: false }),
		);
	});
});
