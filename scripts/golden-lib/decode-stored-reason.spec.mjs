import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect } from 'vitest';

import { decodeStoredReason } from './decode-stored-reason.mjs';

describe('decodeStoredReason', () => {
	it('decompresses a zstd row to its JSON text', () => {
		const body = zstdCompressSync(Buffer.from('{"memberCount":2}', 'utf8'));

		expect(decodeStoredReason(body, 'zstd')).toBe('{"memberCount":2}');
	});

	it('reads an uncompressed row as UTF-8', () => {
		expect(decodeStoredReason(new TextEncoder().encode('{"a":"é"}'), 'none')).toBe(
			'{"a":"é"}',
		);
	});

	it('rejects an unknown codec', () => {
		expect(() => decodeStoredReason(new Uint8Array(), 'gzip')).toThrow(
			'Unknown page_template_clusters.codec: gzip',
		);
	});
});
