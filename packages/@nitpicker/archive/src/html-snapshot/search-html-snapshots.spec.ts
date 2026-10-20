import type { SearchPattern } from './types.js';

import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect } from 'vitest';

import { searchHtmlSnapshots } from './search-html-snapshots.js';

const NEEDLE: SearchPattern = {
	source: 'needle',
	literal: true,
	ignoreCase: false,
	multiLine: false,
	dotAll: false,
};

describe('searchHtmlSnapshots', () => {
	it('searches stored snapshots of both codecs, one outcome each in input order', async () => {
		const outcomes = await searchHtmlSnapshots({
			pattern: NEEDLE,
			snippetLength: 20,
			snapshots: [
				{ body: zstdCompressSync(Buffer.from('<p>needle</p>')), codec: 'zstd' },
				{ body: Buffer.from('<p>x</p>'), codec: 'none' },
			],
		});
		expect(outcomes).toEqual([
			{ matchCount: 1, snippet: '<p>needle</p>' },
			{ matchCount: 0, snippet: '' },
		]);
	});

	it('rejects the whole batch when a snapshot is not valid zstd', async () => {
		await expect(
			searchHtmlSnapshots({
				pattern: NEEDLE,
				snippetLength: 20,
				snapshots: [{ body: Buffer.from('not zstd'), codec: 'zstd' }],
			}),
		).rejects.toThrow(/snapshot 0 could not be decoded/);
	});
});
