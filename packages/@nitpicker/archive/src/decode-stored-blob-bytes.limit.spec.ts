import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect, vi } from 'vitest';

vi.mock('@nitpicker/core/max-decoded-snapshot-bytes', () => ({
	MAX_DECODED_SNAPSHOT_BYTES: 1024,
}));

const { decodeStoredBlobBytes } = await import('./decode-stored-blob-bytes.js');

describe('decodeStoredBlobBytes with the limit on one decompressed snapshot', () => {
	it('decompresses a zstd blob to exactly the limit', () => {
		const html = Buffer.alloc(1024, 'a');
		expect(decodeStoredBlobBytes(zstdCompressSync(html), 'zstd').equals(html)).toBe(true);
	});

	it('throws, naming the limit, for a zstd blob that decompresses past it', () => {
		const stored = zstdCompressSync(Buffer.alloc(1025, 'a'));
		expect(() => decodeStoredBlobBytes(stored, 'zstd')).toThrow(
			/decompresses to more than 1024 bytes/,
		);
	});

	it('returns an uncompressed blob as-is whatever its size', () => {
		const html = Buffer.alloc(4096, 'a');
		expect(decodeStoredBlobBytes(html, 'none').equals(html)).toBe(true);
	});
});
