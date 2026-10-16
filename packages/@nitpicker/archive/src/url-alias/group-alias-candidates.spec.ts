import { describe, it, expect } from 'vitest';

import { groupAliasCandidates } from './group-alias-candidates.js';

// The grouping rules are covered in `@nitpicker/core` and by the parity spec;
// this checks that the archive entry point reaches the native grouping.
describe('groupAliasCandidates', () => {
	it('points the longer URL of a Tier A pair at the shorter', () => {
		const page = { titleTextId: 1, canonicalUrlId: null, bodyHash: null };
		expect([
			...groupAliasCandidates([
				{ ...page, url: 'http://example.com/a/index.html', urlId: 1 },
				{ ...page, url: 'https://example.com/a/', urlId: 2 },
				{ ...page, url: 'https://example.com/b/', urlId: 3 },
			]),
		]).toStrictEqual([1, -1, -1]);
	});
});
