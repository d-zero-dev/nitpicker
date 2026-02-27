import { describe, it, expect } from 'vitest';

import { protocolAgnosticKey } from './protocol-agnostic-key.js';

describe('protocolAgnosticKey', () => {
	it('strips https: from URL', () => {
		expect(protocolAgnosticKey('https://example.com/page')).toBe('//example.com/page');
	});

	it('strips http: from URL', () => {
		expect(protocolAgnosticKey('http://example.com/page')).toBe('//example.com/page');
	});

	it('produces the same key for http and https', () => {
		expect(protocolAgnosticKey('http://example.com/page')).toBe(
			protocolAgnosticKey('https://example.com/page'),
		);
	});

	it('handles URLs with ports', () => {
		expect(protocolAgnosticKey('https://example.com:8080/page')).toBe(
			'//example.com:8080/page',
		);
	});

	it('does not strip non-HTTP protocols', () => {
		expect(protocolAgnosticKey('ftp://example.com/file')).toBe('ftp://example.com/file');
	});

	it('handles URL without path', () => {
		expect(protocolAgnosticKey('https://example.com')).toBe('//example.com');
	});

	it('handles withoutHashAndAuth style strings', () => {
		// withoutHashAndAuth produces strings like "https://example.com/path"
		const httpKey = protocolAgnosticKey('http://example.com/path');
		const httpsKey = protocolAgnosticKey('https://example.com/path');
		expect(httpKey).toBe(httpsKey);
	});
});
