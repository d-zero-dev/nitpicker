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
		});
	});

	it('throws for invalid duplicates field', () => {
		expect(() => mapFlagsToQueryOptions('duplicates', { field: 'invalid' })).toThrow(
			'Invalid --field value',
		);
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

	it('maps mismatches flags correctly', () => {
		expect(
			mapFlagsToQueryOptions('mismatches', { type: 'canonical', limit: 50 }),
		).toEqual({
			type: 'canonical',
			limit: 50,
			offset: undefined,
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
});
