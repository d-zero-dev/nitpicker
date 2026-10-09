import type { JsonLdRow } from './types.js';

import { describe, it, expect } from 'vitest';

import { summarizeJsonLd } from './summarize-jsonld.js';

/**
 * Builds a {@link JsonLdRow} with sensible defaults.
 * @param o
 */
function row(o: Partial<JsonLdRow> = {}): JsonLdRow {
	return {
		id: 0,
		pageId: 0,
		kind: 'ld+json',
		type: null,
		raw: '',
		parsed: null,
		parseError: null,
		...o,
	};
}

describe('summarizeJsonLd', () => {
	it('returns empty summary for no rows', () => {
		expect(summarizeJsonLd([])).toEqual({ count: 0, types: [], parseErrorCount: 0 });
	});

	it('deduplicates and sorts type values', () => {
		const result = summarizeJsonLd([
			row({ type: 'Product' }),
			row({ type: 'Offer' }),
			row({ type: 'Product' }),
			row({ type: 'BreadcrumbList' }),
		]);
		expect(result.count).toBe(4);
		expect(result.types).toEqual(['BreadcrumbList', 'Offer', 'Product']);
	});

	it('renders null type as "(unknown)" in the type list', () => {
		const result = summarizeJsonLd([row({ type: null }), row({ type: 'Article' })]);
		expect(result.types).toEqual(['(unknown)', 'Article']);
	});

	it('counts entries with parseError', () => {
		const result = summarizeJsonLd([
			row({ parseError: 'bad JSON' }),
			row({ type: 'Product' }),
			row({ parseError: 'truncated' }),
		]);
		expect(result.parseErrorCount).toBe(2);
		expect(result.count).toBe(3);
	});
});
