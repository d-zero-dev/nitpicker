import { zstdCompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decodeJsonRef } from './decode-json-ref.js';

describe('decodeJsonRef', () => {
	it('decodes a zstd-compressed body back to the exact original JSON string', () => {
		const original = '{"lang":"en","title":"Page 1"}';
		const compressed = zstdCompressSync(Buffer.from(original, 'utf8'));
		expect(decodeJsonRef(compressed, 'zstd')).toBe(original);
	});

	it('passes a plain-text body through under the none codec', () => {
		expect(decodeJsonRef('{"a":1}', 'none')).toBe('{"a":1}');
		expect(decodeJsonRef(Buffer.from('{"b":2}', 'utf8'), 'none')).toBe('{"b":2}');
	});

	it('returns null for an absent body', () => {
		expect(decodeJsonRef(null, null)).toBeNull();
	});

	it('fails closed to null on a corrupt zstd body instead of throwing', () => {
		const corrupt = Buffer.from('not-a-zstd-frame');
		expect(decodeJsonRef(corrupt, 'zstd')).toBeNull();
	});
});
