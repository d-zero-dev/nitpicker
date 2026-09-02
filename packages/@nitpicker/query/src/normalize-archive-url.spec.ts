import { describe, it, expect } from 'vitest';

import { normalizeArchiveUrl } from './normalize-archive-url.js';

describe('normalizeArchiveUrl', () => {
	it('strips the hash and auth, matching the archive-stored form', () => {
		expect(normalizeArchiveUrl('https://user:pass@example.com/page#section', false)).toBe(
			'https://example.com/page',
		);
	});

	it('sorts query parameters when disableQueries is false', () => {
		expect(normalizeArchiveUrl('https://example.com/page?b=2&a=1', false)).toBe(
			'https://example.com/page?a=1&b=2',
		);
	});

	it('strips query parameters entirely when disableQueries is true', () => {
		expect(normalizeArchiveUrl('https://example.com/page?b=2&a=1', true)).toBe(
			'https://example.com/page',
		);
	});

	it('returns null for a non-HTTP scheme', () => {
		expect(normalizeArchiveUrl('mailto:test@example.com', false)).toBeNull();
	});

	it('returns null for an unparseable string', () => {
		expect(normalizeArchiveUrl('not a url', false)).toBeNull();
	});

	it('is idempotent on an already-normalized URL', () => {
		const normalized = normalizeArchiveUrl('https://example.com/page', false);
		expect(normalizeArchiveUrl(normalized!, false)).toBe(normalized);
	});
});
