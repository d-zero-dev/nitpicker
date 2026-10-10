import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect } from 'vitest';

import { decodeStoredBlobBytes } from './decode-stored-blob-bytes.js';

const HTML = '<body>日本語 😀</body>';

describe('decodeStoredBlobBytes', () => {
	it('decompresses a zstd blob to the original UTF-8 bytes', () => {
		const stored = zstdCompressSync(Buffer.from(HTML, 'utf8'));
		expect(decodeStoredBlobBytes(stored, 'zstd').toString('hex')).toBe(
			Buffer.from(HTML, 'utf8').toString('hex'),
		);
	});

	it('returns an uncompressed blob as-is', () => {
		const stored = new Uint8Array(Buffer.from(HTML, 'utf8'));
		expect(decodeStoredBlobBytes(stored, 'none').toString('utf8')).toBe(HTML);
	});

	it('rejects an unknown codec', () => {
		expect(() => decodeStoredBlobBytes(new Uint8Array(), 'brotli')).toThrow(
			'Unknown page_html_blobs.codec: brotli',
		);
	});
});
