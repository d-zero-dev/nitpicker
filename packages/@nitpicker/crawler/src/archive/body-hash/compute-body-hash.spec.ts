import { describe, it, expect } from 'vitest';

import { computeBodyHash } from './compute-body-hash.js';

describe('computeBodyHash', () => {
	it('produces a 32-byte Buffer', () => {
		const hash = computeBodyHash('<html><body>hello</body></html>');
		expect(hash).toBeInstanceOf(Buffer);
		expect(hash.byteLength).toBe(32);
	});

	it('is deterministic for equal input', () => {
		const html = '<html><body>hello</body></html>';
		expect(computeBodyHash(html).equals(computeBodyHash(html))).toBe(true);
	});

	it('hashes two pages equal when they differ only in an embedded dynamic id', () => {
		const a = computeBodyHash('<body><a href="/user/a1b2c3d4/">profile</a></body>');
		const b = computeBodyHash('<body><a href="/user/z9y8x7w6/">profile</a></body>');
		expect(a.equals(b)).toBe(true);
	});

	it('hashes two pages equal when they differ only in /index.html notation', () => {
		const a = computeBodyHash('<body><a href="/about/index.html">about</a></body>');
		const b = computeBodyHash('<body><a href="/about/">about</a></body>');
		expect(a.equals(b)).toBe(true);
	});

	it('hashes genuinely different content differently', () => {
		const a = computeBodyHash('<body>Page A content</body>');
		const b = computeBodyHash('<body>Page B content</body>');
		expect(a.equals(b)).toBe(false);
	});

	it('does not throw and returns a hash for HTML without a <body> tag', () => {
		const hash = computeBodyHash('<div>fragment only</div>');
		expect(hash.byteLength).toBe(32);
	});

	it('does not throw for an empty string and matches SHA-256("")', () => {
		expect(computeBodyHash('').toString('hex')).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});
});
