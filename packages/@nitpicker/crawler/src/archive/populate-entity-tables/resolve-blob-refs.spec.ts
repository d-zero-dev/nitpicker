import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populateBlobRefs } from '../populate-ref-tables/populate-blob-refs.js';

import { resolveBlobRefs } from './resolve-blob-refs.js';
import { setupMigrationDb } from './test-utils/setup-entities-db.js';

describe('resolveBlobRefs', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('resolves blob_refs.id for large data URIs present in the dictionary', async () => {
		const longDataUri = 'data:image/png;base64,' + 'A'.repeat(600);
		await db('images').insert([
			{
				pageId: 1,
				src: longDataUri,
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: null,
			},
		]);
		await populateBlobRefs(db);
		const map = await resolveBlobRefs(db, [longDataUri]);
		expect(map.get(longDataUri)).toBeTypeOf('number');
	});

	it('skips values that fail the data-URI routing rule', async () => {
		const shortDataUri = 'data:image/svg+xml;base64,PHN2Zy8+';
		const plainUrl = 'https://example.com/img.png';
		const map = await resolveBlobRefs(db, [shortDataUri, plainUrl]);
		expect(map.size).toBe(0);
	});

	it('resolves both raw URIs when two distinct data-URI headers decode to the same payload', async () => {
		// Regression guard: a last-wins hash → value map would drop the
		// earlier raw URI and leave that image row with a NULL
		// src_blob_id. Both raw URIs must resolve to the shared
		// blob_refs.id.
		const payloadPadding = 'A'.repeat(600);
		const uriPng = 'data:image/png;base64,' + payloadPadding;
		const uriSvg = 'data:image/svg+xml;base64,' + payloadPadding;
		await db('images').insert([
			{
				pageId: 1,
				src: uriPng,
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: null,
			},
			{
				pageId: 1,
				src: uriSvg,
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: null,
			},
		]);
		await populateBlobRefs(db);
		const map = await resolveBlobRefs(db, [uriPng, uriSvg]);
		expect(map.get(uriPng)).toBeTypeOf('number');
		expect(map.get(uriSvg)).toBe(map.get(uriPng));
	});
});
