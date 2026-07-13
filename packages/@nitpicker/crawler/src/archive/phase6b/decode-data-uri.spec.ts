// cSpell:ignore Csvg Fsvg
import { describe, it, expect } from 'vitest';

import { decodeDataUri } from './decode-data-uri.js';

describe('decodeDataUri', () => {
	it('decodes base64 data URIs', () => {
		const uri = 'data:image/png;base64,SGVsbG8='; // 'Hello'
		const out = decodeDataUri(uri);
		expect(out).not.toBeNull();
		expect(out!.bytes.toString('utf8')).toBe('Hello');
	});

	it('decodes percent-encoded data URIs', () => {
		const uri = 'data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E';
		const out = decodeDataUri(uri);
		expect(out).not.toBeNull();
		expect(out!.bytes.toString('utf8')).toBe('<svg></svg>');
	});

	it('accepts empty payloads', () => {
		expect(decodeDataUri('data:,')!.bytes.byteLength).toBe(0);
		expect(decodeDataUri('data:image/png;base64,')!.bytes.byteLength).toBe(0);
	});

	it('returns null for non-data URIs', () => {
		expect(decodeDataUri('https://example.com/foo.png')).toBeNull();
		expect(decodeDataUri('mailto:x@example.com')).toBeNull();
	});

	it('returns null for malformed data URIs (no comma)', () => {
		expect(decodeDataUri('data:image/png;base64_no_comma')).toBeNull();
	});

	it('returns null for malformed percent encoding', () => {
		expect(decodeDataUri('data:image/svg+xml,%GG')).toBeNull();
	});

	it('preserves arbitrary binary bytes in non-base64 percent-encoded payload', () => {
		const uri = 'data:application/octet-stream,%FF%00%C3%A9';
		const out = decodeDataUri(uri);
		expect(out).not.toBeNull();
		// Decimals rather than hex to sidestep the local prettier vs
		// unicorn/number-literal-case conflict — prettier lowercases hex
		// letters, unicorn demands uppercase. 255=0xFF, 0=0x00, 195=0xC3,
		// 169=0xA9.
		expect([...out!.bytes]).toEqual([255, 0, 195, 169]);
	});
});
