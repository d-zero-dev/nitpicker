import { zstdCompressSync } from 'node:zlib';

import { describe, it, expect } from 'vitest';

import { decodePageHtmlBlobBytes } from './decode-page-html-blob-bytes.js';

const HASH = Buffer.from('ab01', 'hex');

describe('decodePageHtmlBlobBytes', () => {
	it('decodes a zstd blob to its UTF-8 bytes', () => {
		const html = Buffer.from('<p>日本語</p>', 'utf8');
		const decoded = decodePageHtmlBlobBytes({
			pageId: 7,
			hash: HASH,
			body: zstdCompressSync(html),
			codec: 'zstd',
		});
		expect(decoded.equals(html)).toBe(true);
	});

	it('names the page and the blob hash when the blob cannot be decoded', () => {
		const call = () =>
			decodePageHtmlBlobBytes({
				pageId: 7,
				hash: HASH,
				body: Buffer.from('not zstd'),
				codec: 'zstd',
			});
		expect(call).toThrow(
			/^HTML snapshot of page 7 \(page_html_blobs hash ab01\) could not be decoded: /,
		);
	});

	it('keeps the decoder error as the cause', () => {
		const call = () =>
			decodePageHtmlBlobBytes({
				pageId: 7,
				hash: HASH,
				body: Buffer.from('<p>'),
				codec: 'brotli',
			});
		expect(call).toThrow(
			expect.objectContaining({
				message: expect.stringContaining('Unknown page_html_blobs.codec: brotli'),
				cause: expect.objectContaining({
					message: 'Unknown page_html_blobs.codec: brotli',
				}),
			}),
		);
	});
});
