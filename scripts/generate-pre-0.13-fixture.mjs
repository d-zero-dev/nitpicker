#!/usr/bin/env node
/**
 * Generates a pre-0.13-shaped `.nitpicker` fixture archive: the legacy
 * write-model tables (`pages` / `anchors` / `images` / `resources` /
 * `resources-referrers`) populated with a small crawl's worth of data,
 * plus the adjunct tables in their old form whose FK columns still point
 * at `pages(id)`.
 *
 * The current crawler cannot produce this shape — `initSchema` no longer
 * declares the legacy DDL and the write path targets the entity tables —
 * so tests that exercise `scripts/migrate-to-0.13.mjs` end-to-end (the
 * `viewer-migrated-archive` E2E) generate their input through this
 * script. The legacy DDL itself comes from the crawler's shared
 * `setupLegacyFkDb` test helper, keeping a single source of truth for
 * the pre-0.13 shape.
 *
 * USAGE
 * -----
 *
 *     node scripts/generate-pre-0.13-fixture.mjs <output.nitpicker>
 *
 * NOT SHIPPED IN NPM — like the migration scripts, this runs from a
 * `git clone` + `yarn build` checkout (it imports the crawler's compiled
 * `lib/` directly).
 */

/* eslint-disable no-console */

import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import Archive from '../packages/@nitpicker/crawler/lib/archive/archive.js';
import { setupLegacyFkDb } from '../packages/@nitpicker/crawler/lib/archive/test-utils/setup-legacy-fk-db.js';

/**
 * Entry point.
 */
async function main() {
	const [outputArg] = process.argv.slice(2);
	if (!outputArg) {
		console.error('Usage: node scripts/generate-pre-0.13-fixture.mjs <output.nitpicker>');
		process.exit(1);
	}
	const outputPath = path.resolve(outputArg);
	if (existsSync(outputPath)) {
		console.error(`Output already exists: ${outputPath} — remove it first`);
		process.exit(1);
	}

	const archive = await Archive.create({
		filePath: outputPath,
		cwd: path.dirname(outputPath),
	});
	try {
		await archive.setConfig({
			baseUrl: 'http://localhost',
			name: 'pre-0.13-fixture',
			version: '0.10.0',
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			roots: ['http://localhost'],
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'fixture',
			ignoreRobots: false,
		});
		const knex = archive.getKnex();
		await setupLegacyFkDb(knex);

		const [pageA] = await knex('pages')
			.insert({
				url: 'http://localhost/a',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: '{}',
				title: 'Page A',
				isSkipped: 0,
			})
			.returning('id');
		const [pageB] = await knex('pages')
			.insert({
				url: 'http://localhost/b',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: '{}',
				title: 'Page B',
				isSkipped: 0,
			})
			.returning('id');
		await knex('anchors').insert([
			{ pageId: pageA.id, hrefId: pageB.id, textContent: 'link1', hash: null },
			{ pageId: pageA.id, hrefId: pageB.id, textContent: 'link2', hash: null },
			{ pageId: pageB.id, hrefId: pageA.id, textContent: 'back', hash: null },
		]);
		const [resource] = await knex('resources')
			.insert({
				url: 'http://localhost/style.css',
				isExternal: 0,
				status: 200,
				statusText: 'OK',
				contentType: 'text/css',
				contentLength: 42,
				responseHeaders: '{}',
			})
			.returning('id');
		await knex('resources-referrers').insert([
			{ resourceId: resource.id, pageId: pageA.id },
			{ resourceId: resource.id, pageId: pageB.id },
		]);

		// One row per retarget-covered adjunct table (old `pages(id)` FK
		// shape) so the migration's FK rebuild carries data, not just DDL.
		await knex('page_errors').insert({
			pageId: pageA.id,
			phase: 'screenshot',
			message: 'viewport switch failed',
			createdAt: 1000,
		});
		await knex('page_tags').insert({
			pageId: pageA.id,
			provider: 'WordPress',
			category: 'CMS',
			externalId: 'wp',
			confidence: 100,
		});
		await knex('page_jsonld').insert({
			pageId: pageB.id,
			kind: 'json-ld',
			type: 'Article',
			raw: '{"@type":"Article"}',
		});
		await knex('analysis_text_refs').insert({
			id: 1,
			text: 'Missing alt attribute',
			sha256: 'a'.repeat(64),
		});
		await knex('analysis_violations').insert({
			page_id: pageB.id,
			validator: 'markuplint',
			severity: 'error',
			rule: 'required-attr',
			message_text_id: 1,
			page_url_sort_key: 'http://localhost/b',
			message_sort_key: 'Missing alt attribute',
			code_sort_key: '',
		});
		const htmlHash = Buffer.alloc(32, 7);
		await knex('page_html_blobs').insert({
			hash: htmlHash,
			body: Buffer.from('<html><body>A</body></html>'),
			codec: 'none',
			size_raw: 27,
			size_stored: 27,
		});
		await knex('page_html_ref').insert({ page_id: pageA.id, hash: htmlHash });
	} finally {
		await archive.close();
	}
	console.log(`Fixture written: ${outputPath}`);
}

try {
	await main();
} catch (error) {
	console.error(error);
	process.exit(1);
}
