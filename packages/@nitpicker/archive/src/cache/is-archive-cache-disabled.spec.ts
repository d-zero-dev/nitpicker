import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isArchiveCacheDisabled } from './is-archive-cache-disabled.js';

const ORIGINAL = process.env.NITPICKER_DISABLE_TAR_CACHE;

beforeEach(() => {
	delete process.env.NITPICKER_DISABLE_TAR_CACHE;
});

afterEach(() => {
	if (ORIGINAL === undefined) {
		delete process.env.NITPICKER_DISABLE_TAR_CACHE;
	} else {
		process.env.NITPICKER_DISABLE_TAR_CACHE = ORIGINAL;
	}
});

describe('isArchiveCacheDisabled', () => {
	it('returns false when the env var is unset (cache is on by default)', () => {
		expect(isArchiveCacheDisabled()).toBe(false);
	});

	for (const value of ['1', 'true', 'TRUE', 'yes', 'YES', 'on', 'On']) {
		it(`treats ${JSON.stringify(value)} as a disable signal`, () => {
			process.env.NITPICKER_DISABLE_TAR_CACHE = value;
			expect(isArchiveCacheDisabled()).toBe(true);
		});
	}

	for (const value of ['0', 'false', 'no', 'off', '', 'maybe']) {
		it(`leaves the cache enabled for ${JSON.stringify(value)} (must avoid the "any nonempty value = on" footgun)`, () => {
			// Many shell users set `FOO=0` expecting "off" — accepting only
			// the explicit truthy strings means a typo or zero never
			// silently disables the cache.
			process.env.NITPICKER_DISABLE_TAR_CACHE = value;
			expect(isArchiveCacheDisabled()).toBe(false);
		});
	}

	it('trims whitespace before matching so `\\n 1 ` from a docker env-file still disables', () => {
		process.env.NITPICKER_DISABLE_TAR_CACHE = ' 1\n';
		expect(isArchiveCacheDisabled()).toBe(true);
	});
});
