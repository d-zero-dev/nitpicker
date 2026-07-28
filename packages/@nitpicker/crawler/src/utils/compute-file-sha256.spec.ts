import { describe, expect, it } from 'vitest';

import { computeFileSha256 } from './compute-file-sha256.js';

describe('computeFileSha256', () => {
	it('returns the canonical SHA-256 digest for an empty buffer', () => {
		// `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
		// is the SHA-256 of the empty byte sequence — a fixed reference value
		// the implementation MUST reproduce.
		const digest = computeFileSha256(Buffer.alloc(0));
		expect(digest).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});

	it('returns the canonical SHA-256 digest for the ASCII string "hello"', () => {
		// `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`
		// is the SHA-256 of `Buffer.from('hello')` — pins the hash algorithm.
		const digest = computeFileSha256(Buffer.from('hello'));
		expect(digest).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
		);
	});

	it('produces the canonical SHA-256 of a >1MB buffer', () => {
		// Precomputed via `crypto.createHash('sha256').update(Buffer.alloc(1500000, 0x61)).digest('hex')`.
		const digest = computeFileSha256(Buffer.alloc(1_500_000, 0x61));
		expect(digest).toBe(
			'f30207a92765493dcdd80a5a2b541b3f67073c413676ab523b30c4feb12fac90',
		);
	});
});
