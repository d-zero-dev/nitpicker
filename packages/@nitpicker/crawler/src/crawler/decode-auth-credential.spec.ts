import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { decodeAuthCredential } from './decode-auth-credential.js';

describe('decodeAuthCredential', () => {
	it('returns plain ASCII credentials unchanged', () => {
		expect(decodeAuthCredential('user')).toBe('user');
		expect(decodeAuthCredential('p4ssw0rd')).toBe('p4ssw0rd');
	});

	it('decodes percent-encoded special characters', () => {
		// `[`, `]`, `{`, `}`, `=` are outside RFC 3986 userinfo and get
		// percent-encoded by the WHATWG URL parser.
		expect(decodeAuthCredential('a%5Bb%5Dc%7Bd%7De%3D')).toBe('a[b]c{d}e=');
		expect(decodeAuthCredential('%3A%40')).toBe(':@');
	});

	it('decodes what the WHATWG URL parser encoded (round-trip)', () => {
		const url = parseUrl('https://user:pa%5Dss%5Bwo%7Brd%7D%3D@example.com/')!;
		// WHATWG keeps the userinfo percent-encoded in the field.
		expect(url.password).toBe('pa%5Dss%5Bwo%7Brd%7D%3D');
		expect(decodeAuthCredential(url.password)).toBe('pa]ss[wo{rd}=');
	});

	it('does not treat "+" as a space (not form encoding)', () => {
		expect(decodeAuthCredential('pass+word')).toBe('pass+word');
	});

	it('decodes multi-byte UTF-8 sequences', () => {
		expect(decodeAuthCredential('%E3%83%91%E3%82%B9')).toBe('パス');
	});

	it('yields a literal "%" when escaped as %25 (the documented escape)', () => {
		// A password whose literal characters are `pa%5Bss` must be written
		// `pa%255Bss` in the URL — one decode pass yields the literal back.
		expect(decodeAuthCredential('pa%255Bss')).toBe('pa%5Bss');
	});

	it('falls back to the raw value when the sequence is malformed', () => {
		// A literal `%` not followed by two hex digits is left as-is by the
		// WHATWG parser and would make decodeURIComponent throw.
		expect(decodeAuthCredential('pa%ssword')).toBe('pa%ssword');
		expect(decodeAuthCredential('100%')).toBe('100%');
	});

	it('returns an empty string for null and empty input', () => {
		expect(decodeAuthCredential(null)).toBe('');
		expect(decodeAuthCredential('')).toBe('');
	});
});
