import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHtmlSelectorFixtureArchive } from '../test-helpers/create-html-selector-fixture-archive.js';

import { createHtmlSnapshotCandidateQuery } from './create-html-snapshot-candidate-query.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_html_snapshot_candidate_query__',
);

describe('createHtmlSnapshotCandidateQuery', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;

	beforeAll(async () => {
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'candidate-query.nitpicker',
			pages: [
				{ url: 'https://example.com', html: '<p>top</p>' },
				{ url: 'https://example.com/blog/post', html: '<p>post</p>' },
				{ url: 'https://example.com/blog', html: '<p>blog</p>' },
				{ url: 'https://example.com/doc.pdf', html: '', contentType: 'application/pdf' },
				{ url: 'https://example.com/excluded', html: '<p>x</p>', isSkipped: true },
			],
		});
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	/**
	 * Runs the candidate query and returns its page URLs in page-id order.
	 * @param filters - Filters passed to the query.
	 * @returns The candidate page URLs.
	 */
	async function candidateUrls(
		filters?: Parameters<typeof createHtmlSnapshotCandidateQuery>[1],
	): Promise<string[]> {
		const rows = (await createHtmlSnapshotCandidateQuery(archive.getKnex(), filters)
			.select('ur.url as url')
			.orderBy('ci.id')) as { url: string }[];
		return rows.map((row) => row.url);
	}

	it('keeps only non-skipped pages that have a stored snapshot', async () => {
		expect(await candidateUrls()).toEqual([
			'https://example.com',
			'https://example.com/blog/post',
			'https://example.com/blog',
		]);
	});

	it('narrows by a SQL LIKE urlPattern', async () => {
		expect(await candidateUrls({ urlPattern: '%/post' })).toEqual([
			'https://example.com/blog/post',
		]);
	});

	it('narrows by directory, treating it as a path prefix with a trailing slash', async () => {
		expect(await candidateUrls({ directory: '/blog' })).toEqual([
			'https://example.com/blog/post',
		]);
		expect(await candidateUrls({ directory: '/blog/' })).toEqual([
			'https://example.com/blog/post',
		]);
	});

	it('returns a fresh query each call', () => {
		const knex = archive.getKnex();
		expect(createHtmlSnapshotCandidateQuery(knex)).not.toBe(
			createHtmlSnapshotCandidateQuery(knex),
		);
	});
});
