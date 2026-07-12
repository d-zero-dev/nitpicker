import { describe, it, expect } from 'vitest';

import { computeContentHash } from './compute-content-hash.js';

describe('computeContentHash', () => {
	it('produces a 32-byte Buffer', () => {
		const hash = computeContentHash('hello');
		expect(hash).toBeInstanceOf(Buffer);
		expect(hash.byteLength).toBe(32);
	});

	it('is deterministic for equal string input', () => {
		const a = computeContentHash('same input');
		const b = computeContentHash('same input');
		expect(a.equals(b)).toBe(true);
	});

	it('differs across distinct inputs', () => {
		const a = computeContentHash('a');
		const b = computeContentHash('b');
		expect(a.equals(b)).toBe(false);
	});

	it('treats string and equivalent Uint8Array identically', () => {
		const value = 'utf-8 test 日本語';
		const fromString = computeContentHash(value);
		const fromBytes = computeContentHash(Buffer.from(value, 'utf8'));
		expect(fromString.equals(fromBytes)).toBe(true);
	});

	it('matches known SHA-256 vector', () => {
		// Well-known SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
		expect(computeContentHash('').toString('hex')).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});
});
