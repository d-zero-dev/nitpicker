import { describe, it, expect } from 'vitest';

import { mapFlagsToQueryOptions } from './map-flags-to-query-options.js';

describe('mapFlagsToQueryOptions', () => {
	it('returns empty object for summary', () => {
		expect(mapFlagsToQueryOptions('summary', {})).toEqual({});
	});

	it('maps pages flags correctly', () => {
		const result = mapFlagsToQueryOptions('pages', {
			status: 404,
			statusMin: 400,
			statusMax: 499,
			isExternal: false,
			missingTitle: true,
			sortBy: 'status',
			sortOrder: 'desc',
			limit: 50,
			offset: 10,
		});
		expect(result).toEqual({
			status: 404,
			statusMin: 400,
			statusMax: 499,
			isExternal: false,
			contentTypeCategory: undefined,
			missingTitle: true,
			missingDescription: undefined,
			noindex: undefined,
			urlPattern: undefined,
			directory: undefined,
			sortBy: 'status',
			sortOrder: 'desc',
			limit: 50,
			offset: 10,
		});
	});

	it('passes through valid --contentTypeCategory', () => {
		const result = mapFlagsToQueryOptions('pages', { contentTypeCategory: 'pdf' }) as {
			contentTypeCategory: string | undefined;
		};
		expect(result.contentTypeCategory).toBe('pdf');
	});

	it('throws for invalid --contentTypeCategory', () => {
		// Without validation, listPages would crash with a TypeError far from the
		// CLI entry point; the user-facing message names the flag and lists the
		// accepted values so they can self-correct.
		expect(() =>
			mapFlagsToQueryOptions('pages', { contentTypeCategory: 'jpeg' }),
		).toThrow('Invalid --contentTypeCategory value: jpeg');
	});

	it('throws for invalid sortBy value', () => {
		expect(() => mapFlagsToQueryOptions('pages', { sortBy: 'invalid' })).toThrow(
			'Invalid --sortBy value',
		);
	});

	it('throws for invalid sortOrder value', () => {
		expect(() => mapFlagsToQueryOptions('pages', { sortOrder: 'invalid' })).toThrow(
			'Invalid --sortOrder value',
		);
	});

	it('requires --url for page-detail', () => {
		expect(() => mapFlagsToQueryOptions('page-detail', {})).toThrow(
			'--url is required for the page-detail sub-command',
		);
	});

	it('returns url for page-detail', () => {
		expect(mapFlagsToQueryOptions('page-detail', { url: 'https://example.com' })).toEqual(
			{
				url: 'https://example.com',
			},
		);
	});

	it('requires --url for inbound-links', () => {
		expect(() => mapFlagsToQueryOptions('inbound-links', {})).toThrow(
			'--url is required for the inbound-links sub-command',
		);
	});

	it('throws for invalid inbound-links direction', () => {
		expect(() =>
			mapFlagsToQueryOptions('inbound-links', {
				url: 'https://example.com',
				direction: 'sideways',
			}),
		).toThrow('Invalid --direction value');
	});

	it('returns url/limit/offset/cursor/direction for inbound-links', () => {
		expect(
			mapFlagsToQueryOptions('inbound-links', {
				url: 'https://example.com',
				limit: 10,
				offset: 20,
				cursor: 'abc',
				direction: 'prev',
			}),
		).toEqual({
			url: 'https://example.com',
			limit: 10,
			offset: 20,
			cursor: 'abc',
			direction: 'prev',
		});
	});

	it('requires --url for html', () => {
		expect(() => mapFlagsToQueryOptions('html', {})).toThrow(
			'--url is required for the html sub-command',
		);
	});

	it('returns url and maxLength for html', () => {
		expect(
			mapFlagsToQueryOptions('html', { url: 'https://example.com', maxLength: 5000 }),
		).toEqual({
			url: 'https://example.com',
			maxLength: 5000,
		});
	});

	it('requires --type for links', () => {
		expect(() => mapFlagsToQueryOptions('links', {})).toThrow(
			'--type is required for the links sub-command',
		);
	});

	it('throws for invalid links type', () => {
		expect(() => mapFlagsToQueryOptions('links', { type: 'invalid' })).toThrow(
			'Invalid --type value',
		);
	});

	it('maps links flags correctly', () => {
		expect(
			mapFlagsToQueryOptions('links', { type: 'broken', limit: 20, offset: 5 }),
		).toEqual({
			type: 'broken',
			limit: 20,
			offset: 5,
		});
	});

	it('maps resources flags correctly', () => {
		expect(
			mapFlagsToQueryOptions('resources', { contentType: 'text/css', limit: 10 }),
		).toEqual({
			contentType: 'text/css',
			isExternal: undefined,
			limit: 10,
			offset: undefined,
		});
	});

	it('maps images flags correctly', () => {
		expect(
			mapFlagsToQueryOptions('images', { missingAlt: true, oversizedThreshold: 1000 }),
		).toEqual({
			missingAlt: true,
			missingDimensions: undefined,
			oversizedThreshold: 1000,
			urlPattern: undefined,
			limit: undefined,
			offset: undefined,
		});
	});

	it('maps violations flags correctly', () => {
		expect(
			mapFlagsToQueryOptions('violations', { validator: 'axe', severity: 'critical' }),
		).toEqual({
			validator: 'axe',
			severity: 'critical',
			rule: undefined,
			limit: undefined,
			offset: undefined,
		});
	});

	it('defaults duplicates field to title', () => {
		expect(mapFlagsToQueryOptions('duplicates', {})).toEqual({
			field: 'title',
			limit: undefined,
			pagesLimit: undefined,
			cursor: undefined,
			direction: undefined,
			offset: undefined,
		});
	});

	it('throws for invalid duplicates field', () => {
		expect(() => mapFlagsToQueryOptions('duplicates', { field: 'invalid' })).toThrow(
			'Invalid --field value',
		);
	});

	it('throws for invalid duplicates direction', () => {
		expect(() => mapFlagsToQueryOptions('duplicates', { direction: 'sideways' })).toThrow(
			'Invalid --direction value',
		);
	});

	it('maps duplicates flags correctly, including pagesLimit/cursor/direction', () => {
		expect(
			mapFlagsToQueryOptions('duplicates', {
				field: 'description',
				limit: 10,
				pagesLimit: 5,
				cursor: 'abc',
				direction: 'prev',
				offset: 20,
			}),
		).toEqual({
			field: 'description',
			limit: 10,
			pagesLimit: 5,
			cursor: 'abc',
			direction: 'prev',
			offset: 20,
		});
	});

	it('requires --type for mismatches', () => {
		expect(() => mapFlagsToQueryOptions('mismatches', {})).toThrow(
			'--type is required for the mismatches sub-command',
		);
	});

	it('throws for invalid mismatches type', () => {
		expect(() => mapFlagsToQueryOptions('mismatches', { type: 'broken' })).toThrow(
			'Invalid --type value',
		);
	});

	it('throws for invalid mismatches direction', () => {
		expect(() =>
			mapFlagsToQueryOptions('mismatches', { type: 'canonical', direction: 'sideways' }),
		).toThrow('Invalid --direction value');
	});

	it('maps mismatches flags correctly', () => {
		expect(
			mapFlagsToQueryOptions('mismatches', { type: 'canonical', limit: 50 }),
		).toEqual({
			type: 'canonical',
			limit: 50,
			offset: undefined,
			cursor: undefined,
			direction: undefined,
		});
	});

	it('maps mismatches flags correctly, including cursor/direction', () => {
		expect(
			mapFlagsToQueryOptions('mismatches', {
				type: 'canonical',
				limit: 10,
				offset: 5,
				cursor: 'xyz',
				direction: 'next',
			}),
		).toEqual({
			type: 'canonical',
			limit: 10,
			offset: 5,
			cursor: 'xyz',
			direction: 'next',
		});
	});

	it('maps headers flags correctly', () => {
		expect(mapFlagsToQueryOptions('headers', { missingOnly: true, limit: 25 })).toEqual({
			limit: 25,
			offset: undefined,
			missingOnly: true,
		});
	});

	it('requires --url for resource-referrers', () => {
		expect(() => mapFlagsToQueryOptions('resource-referrers', {})).toThrow(
			'--url is required for the resource-referrers sub-command',
		);
	});

	it('returns url for resource-referrers', () => {
		expect(
			mapFlagsToQueryOptions('resource-referrers', {
				url: 'https://example.com/style.css',
			}),
		).toEqual({
			url: 'https://example.com/style.css',
		});
	});

	it('returns url/limit/cursor for resource-referrers', () => {
		expect(
			mapFlagsToQueryOptions('resource-referrers', {
				url: 'https://example.com/style.css',
				limit: 10,
				cursor: '5',
			}),
		).toEqual({
			url: 'https://example.com/style.css',
			limit: 10,
			cursor: '5',
		});
	});

	it('returns limit/offset only for isolated-pages (no required filters)', () => {
		expect(mapFlagsToQueryOptions('isolated-pages', { limit: 50, offset: 10 })).toEqual({
			limit: 50,
			offset: 10,
		});
	});

	it('returns limit/offset only for unused-resources (no required filters)', () => {
		expect(mapFlagsToQueryOptions('unused-resources', { limit: 25, offset: 0 })).toEqual({
			limit: 25,
			offset: 0,
		});
	});

	it('passes through undefined limit/offset for isolated-pages so query helper defaults apply', () => {
		expect(mapFlagsToQueryOptions('isolated-pages', {})).toEqual({
			limit: undefined,
			offset: undefined,
		});
	});

	it('returns limit/offset only for inventory-runs (no required filters)', () => {
		// Pagination-only sub-command — mirrors the `isolated-pages` /
		// `unused-resources` convention so the audit-log subcommand
		// stays cheap to call with no extra flags.
		expect(mapFlagsToQueryOptions('inventory-runs', { limit: 20, offset: 0 })).toEqual({
			limit: 20,
			offset: 0,
		});
	});

	it('returns limit/offset only for duplicate-bodies (no required filters)', () => {
		expect(mapFlagsToQueryOptions('duplicate-bodies', { limit: 30, offset: 5 })).toEqual({
			limit: 30,
			offset: 5,
		});
	});

	it('returns limit/offset only for outages (no required filters)', () => {
		expect(mapFlagsToQueryOptions('outages', { limit: 20, offset: 0 })).toEqual({
			limit: 20,
			offset: 0,
		});
	});

	it('returns limit/offset only for dedupe-cap-events (no required filters)', () => {
		expect(mapFlagsToQueryOptions('dedupe-cap-events', { limit: 20, offset: 0 })).toEqual(
			{
				limit: 20,
				offset: 0,
			},
		);
	});

	it('maps duplicate-clusters flags, renaming --pagesLimit to samplePagesLimit', () => {
		expect(
			mapFlagsToQueryOptions('duplicate-clusters', {
				minCount: 5,
				limit: 50,
				offset: 25,
				pagesLimit: 3,
			} as never),
		).toEqual({
			minCount: 5,
			limit: 50,
			offset: 25,
			samplePagesLimit: 3,
		});
	});

	it('maps console-logs flags correctly', () => {
		expect(
			mapFlagsToQueryOptions('console-logs', {
				type: 'error',
				sortBy: 'totalCount',
				sortOrder: 'desc',
				limit: 20,
				offset: 0,
			}),
		).toEqual({
			type: 'error',
			sortBy: 'totalCount',
			sortOrder: 'desc',
			limit: 20,
			offset: 0,
		});
	});

	it('rejects an invalid console-logs --sortBy value', () => {
		expect(() => mapFlagsToQueryOptions('console-logs', { sortBy: 'bogus' })).toThrow(
			/Invalid --sortBy value/,
		);
	});

	it('rejects an invalid console-logs --sortOrder value', () => {
		expect(() => mapFlagsToQueryOptions('console-logs', { sortOrder: 'bogus' })).toThrow(
			/Invalid --sortOrder value/,
		);
	});

	it('maps page-console-logs flags correctly', () => {
		expect(
			mapFlagsToQueryOptions('page-console-logs', { url: 'https://example.com' }),
		).toEqual({
			url: 'https://example.com',
		});
	});

	it('page-console-logs requires --url', () => {
		expect(() => mapFlagsToQueryOptions('page-console-logs', {})).toThrow(
			'--url is required for the page-console-logs sub-command.',
		);
	});
});
