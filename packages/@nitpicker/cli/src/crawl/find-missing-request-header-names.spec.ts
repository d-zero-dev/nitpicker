import { describe, expect, it } from 'vitest';

import { findMissingRequestHeaderNames } from './find-missing-request-header-names.js';

describe('findMissingRequestHeaderNames', () => {
	it('returns archived names that were not supplied, ignoring case', () => {
		expect(
			findMissingRequestHeaderNames(['Authorization', 'X-Api-Key'], {
				authorization: 'x',
			}),
		).toEqual(['X-Api-Key']);
	});

	it('returns nothing when every archived name is supplied', () => {
		expect(
			findMissingRequestHeaderNames(['Authorization'], { Authorization: 'x' }),
		).toEqual([]);
	});

	it('returns every archived name when nothing was supplied', () => {
		expect(findMissingRequestHeaderNames(['A', 'B'])).toEqual(['A', 'B']);
	});

	it('returns nothing for an archive without recorded names', () => {
		expect(findMissingRequestHeaderNames(undefined, { A: 'x' })).toEqual([]);
		expect(findMissingRequestHeaderNames([])).toEqual([]);
	});
});
