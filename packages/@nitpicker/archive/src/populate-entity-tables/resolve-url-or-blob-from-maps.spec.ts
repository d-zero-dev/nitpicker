import { describe, it, expect } from 'vitest';

import { resolveUrlOrBlobFromMaps } from './resolve-url-or-blob-from-maps.js';

describe('resolveUrlOrBlobFromMaps', () => {
	it('resolves a regular URL from the url map', () => {
		const urlIds = new Map([['https://example.com/a.png', 1]]);
		const blobIds = new Map<string, number>();
		expect(
			resolveUrlOrBlobFromMaps('https://example.com/a.png', urlIds, blobIds),
		).toEqual({
			url: 1,
			blob: null,
		});
	});

	it('resolves a large data: URI from the blob map', () => {
		const largeDataUri = `data:image/png;base64,${'x'.repeat(600)}`;
		const urlIds = new Map<string, number>();
		const blobIds = new Map([[largeDataUri, 7]]);
		expect(resolveUrlOrBlobFromMaps(largeDataUri, urlIds, blobIds)).toEqual({
			url: null,
			blob: 7,
		});
	});

	it('returns both null when the value is null', () => {
		const urlIds = new Map<string, number>();
		const blobIds = new Map<string, number>();
		expect(resolveUrlOrBlobFromMaps(null, urlIds, blobIds)).toEqual({
			url: null,
			blob: null,
		});
	});

	it('returns both null when the value is an empty string', () => {
		const urlIds = new Map<string, number>();
		const blobIds = new Map<string, number>();
		expect(resolveUrlOrBlobFromMaps('', urlIds, blobIds)).toEqual({
			url: null,
			blob: null,
		});
	});

	it('returns null blob when a large data: URI is missing from the blob map', () => {
		// e.g. the blob_refs row is missing because populateBlobRefs skipped
		// a malformed data URI it could not decode.
		const largeDataUri = `data:image/png;base64,${'x'.repeat(600)}`;
		const urlIds = new Map<string, number>();
		const blobIds = new Map<string, number>();
		expect(resolveUrlOrBlobFromMaps(largeDataUri, urlIds, blobIds)).toEqual({
			url: null,
			blob: null,
		});
	});

	it('returns null url when a regular URL is missing from the url map', () => {
		const urlIds = new Map<string, number>();
		const blobIds = new Map<string, number>();
		expect(
			resolveUrlOrBlobFromMaps('https://example.com/missing.png', urlIds, blobIds),
		).toEqual({ url: null, blob: null });
	});
});
