import type { ArchiveResource as Resource } from '@nitpicker/crawler';

import { Cell } from '@d-zero/google-sheets';
import { describe, it, expect, vi } from 'vitest';

import {
	createResources,
	dedupeKey,
	formatContentLength,
	formatQueryPattern,
	joinReferrersForNote,
	MAX_PARAM_VALUE_SAMPLES,
	NOTE_MAX_LENGTH,
	type DedupeEntry,
} from './create-resources.js';

/**
 * Creates a mock ArchiveResource object with sensible defaults for testing.
 * @param overrides - Properties to override on the default mock resource.
 * @returns A mock Resource instance cast via `as never`.
 */
function createMockResource(overrides: Partial<Record<string, unknown>> = {}): Resource {
	return {
		url: 'https://example.com/style.css',
		status: 200,
		statusText: 'OK',
		contentType: 'text/css',
		contentLength: 5000,
		isExternal: false,
		getReferrers: vi.fn().mockResolvedValue([]),
		...overrides,
	} as never;
}

/**
 * Extracts the primitive value from a Cell by calling `provide()` and reading `userEnteredValue`.
 * @param cell - A Cell object with a `provide` method.
 * @param cell.provide
 * @returns The string, number, boolean, or formula value held by the cell.
 */
function cellValue(cell: {
	provide: (n?: number) => { userEnteredValue: Record<string, unknown> };
}) {
	const provided = cell.provide();
	return (
		provided.userEnteredValue.stringValue ??
		provided.userEnteredValue.numberValue ??
		provided.userEnteredValue.boolValue ??
		provided.userEnteredValue.formulaValue ??
		''
	);
}

/**
 * Extracts the note string from a Cell by calling `provide()`.
 * @param cell - A Cell object with a `provide` method.
 * @param cell.provide
 * @returns The note attached to the cell, or `undefined`.
 */
function cellNote(cell: { provide: (n?: number) => { note?: string } }) {
	return cell.provide().note;
}

describe('createResources (raw mode)', () => {
	it('returns sheet config with name "Resources"', () => {
		const sheet = createResources()([]);
		expect(sheet.name).toBe('Resources');
	});

	it('does not register a finalizeResources hook', () => {
		const sheet = createResources()([]);
		expect(sheet.finalizeResources).toBeUndefined();
	});

	it('uses only eager cells from eachResource so appendRow can stream', async () => {
		const resource = createMockResource();
		const sheet = createResources()([]);
		const rows = await sheet.eachResource!(resource);
		expect(rows).toBeTruthy();
		expect(rows!.length).toBeGreaterThan(0);
		for (const row of rows!) {
			for (const cell of row) {
				expect(cell.provide).toBe(Cell.prototype.provide);
			}
		}
	});

	it('returns correct headers', () => {
		const sheet = createResources()([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'URL',
			'Status Code',
			'Status Text',
			'Content Type',
			'Content Length',
			'Referrers',
		]);
	});

	it('generates row with resource data and referrer count', async () => {
		const resource = createMockResource({
			getReferrers: vi
				.fn()
				.mockResolvedValue([
					'https://example.com/',
					'https://example.com/about',
					'https://example.com/contact',
				]),
		});

		const sheet = createResources()([]);
		const rows = await sheet.eachResource!(resource);

		expect(rows).toHaveLength(1);
		expect(rows![0]).toHaveLength(6);

		expect(cellValue(rows![0][0])).toBe('https://example.com/style.css');
		expect(cellValue(rows![0][1])).toBe(200);
		expect(cellValue(rows![0][2])).toBe('OK');
		expect(cellValue(rows![0][3])).toBe('text/css');
		expect(cellValue(rows![0][4])).toBe(5000);
		expect(cellValue(rows![0][5])).toBe('3 pages');
		expect(cellNote(rows![0][5])).toBe(
			'https://example.com/\nhttps://example.com/about\nhttps://example.com/contact',
		);
	});

	it('shows "0 pages" when resource has no referrers', async () => {
		const resource = createMockResource();
		const sheet = createResources()([]);
		const rows = await sheet.eachResource!(resource);

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][5])).toBe('0 pages');
		expect(cellNote(rows![0][5])).toBe('');
	});

	it('passes null status and contentType as-is', async () => {
		const resource = createMockResource({
			status: null,
			statusText: null,
			contentType: null,
			contentLength: null,
		});

		const sheet = createResources()([]);
		const rows = await sheet.eachResource!(resource);

		expect(cellValue(rows![0][1])).toBe('');
		expect(cellValue(rows![0][2])).toBe('');
		expect(cellValue(rows![0][3])).toBe('');
		expect(cellValue(rows![0][4])).toBe('');
	});

	it('returns single-row array', async () => {
		const resource = createMockResource({
			getReferrers: vi.fn().mockResolvedValue(['https://example.com/']),
		});
		const sheet = createResources()([]);
		const rows = await sheet.eachResource!(resource);

		expect(rows).toHaveLength(1);
		expect(Array.isArray(rows![0])).toBe(true);
	});
});

describe('createResources (dedupe mode) — basic shape', () => {
	it('headers include trailing Count and Query Pattern columns', () => {
		const sheet = createResources({ dedupe: true })([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'URL',
			'Status Code',
			'Status Text',
			'Content Type',
			'Content Length',
			'Referrers',
			'Count',
			'Query Pattern',
		]);
	});

	it('eachResource always returns null in dedupe mode (rows are emitted by finalizeResources)', async () => {
		const sheet = createResources({ dedupe: true })([]);
		const r = createMockResource();
		expect(await sheet.eachResource!(r)).toBeNull();
	});

	it('finalizeResources is registered in dedupe mode', () => {
		const sheet = createResources({ dedupe: true })([]);
		expect(typeof sheet.finalizeResources).toBe('function');
	});

	it('finalizeResources returns [] when no resources were accumulated', async () => {
		const sheet = createResources({ dedupe: true })([]);
		const rows = await sheet.finalizeResources!();
		expect(rows).toEqual([]);
	});
});

describe('createResources (dedupe mode) — aggregation', () => {
	it('collapses raw resources that share a canonical URL into one row', async () => {
		const sheet = createResources({ dedupe: true })([]);
		const r1 = createMockResource({
			url: 'https://x.com/track?id=1&t=now',
			getReferrers: vi.fn().mockResolvedValue(['https://x.com/page-a']),
		});
		const r2 = createMockResource({
			url: 'https://x.com/track?t=later&id=2',
			getReferrers: vi.fn().mockResolvedValue(['https://x.com/page-b']),
		});
		const r3 = createMockResource({
			url: 'https://x.com/track?id=3&t=now',
			getReferrers: vi.fn().mockResolvedValue(['https://x.com/page-c']),
		});

		await sheet.eachResource!(r1);
		await sheet.eachResource!(r2);
		await sheet.eachResource!(r3);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(rows![0]).toHaveLength(8);
		expect(cellValue(rows![0][0])).toBe('https://x.com/track?id&t');
		expect(cellValue(rows![0][6])).toBe(3);
		expect(cellValue(rows![0][5])).toBe('3 pages');
		expect(cellNote(rows![0][5])).toBe(
			'https://x.com/page-a\nhttps://x.com/page-b\nhttps://x.com/page-c',
		);
		expect(cellValue(rows![0][7])).toBe('id=3, t=2');
	});

	it('emits a single row even for a single resource', async () => {
		const sheet = createResources({ dedupe: true })([]);
		const r = createMockResource({
			getReferrers: vi.fn().mockResolvedValue(['https://x.com/a']),
		});
		await sheet.eachResource!(r);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][6])).toBe(1);
	});

	it('separates rows when status differs for the same canonical URL', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({
				url: 'https://x.com/p?a=1',
				status: 200,
				contentType: 'image/gif',
				getReferrers: vi.fn().mockResolvedValue(['https://x.com/a']),
			}),
		);
		await sheet.eachResource!(
			createMockResource({
				url: 'https://x.com/p?a=2',
				status: 404,
				contentType: 'image/gif',
				getReferrers: vi.fn().mockResolvedValue(['https://x.com/b']),
			}),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(2);
		const statuses = rows!.map((row) => cellValue(row[1])).toSorted();
		expect(statuses).toEqual([200, 404]);
		for (const row of rows!) {
			expect(cellValue(row[6])).toBe(1);
		}
	});

	it('separates rows when contentType differs for the same canonical URL and status', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({
				url: 'https://x.com/p?a=1',
				contentType: 'image/gif',
			}),
		);
		await sheet.eachResource!(
			createMockResource({
				url: 'https://x.com/p?a=2',
				contentType: 'image/png',
			}),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(2);
		const types = rows!.map((row) => cellValue(row[3])).toSorted();
		expect(types).toEqual(['image/gif', 'image/png']);
	});

	it('preserves path-embedded tracking IDs when canonicalizing', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({
				url: 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/10840516367/?auid=A&capi=1',
			}),
		);
		await sheet.eachResource!(
			createMockResource({
				url: 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/10840516367/?capi=2&auid=B',
			}),
		);
		await sheet.eachResource!(
			createMockResource({
				url: 'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/9999999/?auid=C',
			}),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(2);
		const urls = rows!.map((row) => cellValue(row[0])).toSorted();
		expect(urls).toEqual([
			'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/10840516367/?auid&capi',
			'https://googleads.g.doubleclick.net/pagead/viewthroughconversion/9999999/?auid',
		]);
	});

	it('unions referrer URLs across all raw resources in a group', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({
				url: 'https://x.com/p?a=1',
				getReferrers: vi
					.fn()
					.mockResolvedValue(['https://x.com/page-a', 'https://x.com/page-b']),
			}),
		);
		await sheet.eachResource!(
			createMockResource({
				url: 'https://x.com/p?a=2',
				getReferrers: vi
					.fn()
					.mockResolvedValue(['https://x.com/page-b', 'https://x.com/page-c']),
			}),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][5])).toBe('3 pages');
		const note = cellNote(rows![0][5]);
		expect(note?.split('\n').toSorted()).toEqual([
			'https://x.com/page-a',
			'https://x.com/page-b',
			'https://x.com/page-c',
		]);
	});

	it('clears internal state after finalizeResources so a second invocation returns []', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(createMockResource());
		const first = await sheet.finalizeResources!();
		expect(first).toHaveLength(1);
		const second = await sheet.finalizeResources!();
		expect(second).toEqual([]);
	});
});

describe('createResources (dedupe mode) — Content Length range', () => {
	it('renders content length as min-max when sizes vary within a group', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=1', contentLength: 100 }),
		);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=2', contentLength: 500 }),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][4])).toBe('100-500');
	});

	it('renders content length as a single number when sizes match within a group', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=1', contentLength: 250 }),
		);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=2', contentLength: 250 }),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][4])).toBe(250);
	});

	it('leaves Content Length empty when every resource in the group reports null', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=1', contentLength: null }),
		);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=2', contentLength: null }),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][4])).toBe('');
	});

	it('absorbs a later non-null contentLength after a leading null in the same group', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=1', contentLength: null }),
		);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=2', contentLength: 800 }),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][4])).toBe(800);
	});

	it('expands an existing range when a smaller or larger non-null contentLength arrives', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=1', contentLength: 500 }),
		);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=2', contentLength: 100 }),
		);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=3', contentLength: 900 }),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][4])).toBe('100-900');
	});
});

describe('createResources (dedupe mode) — statusText merge', () => {
	it('fills statusText from a later non-null resource when the first one was null', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=1', statusText: null }),
		);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=2', statusText: 'OK' }),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][2])).toBe('OK');
	});

	it('does not overwrite a non-null statusText with a later null', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=1', statusText: 'OK' }),
		);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/p?a=2', statusText: null }),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][2])).toBe('OK');
	});
});

describe('dedupeKey', () => {
	it('distinguishes status=null from status=0', () => {
		expect(dedupeKey('https://x.com/', null, 'text/html')).not.toBe(
			dedupeKey('https://x.com/', 0, 'text/html'),
		);
	});

	it('distinguishes contentType=null from contentType=""', () => {
		expect(dedupeKey('https://x.com/', 200, null)).not.toBe(
			dedupeKey('https://x.com/', 200, ''),
		);
	});

	it('produces identical keys for identical inputs', () => {
		expect(dedupeKey('https://x.com/p?a&b', 200, 'image/gif')).toBe(
			dedupeKey('https://x.com/p?a&b', 200, 'image/gif'),
		);
	});

	it('does not let one field bleed into another (no concat collision)', () => {
		// canonical='ab', contentType='cd' vs canonical='abcd', contentType=''
		// — without the U+0001 delimiter these would collide.
		expect(dedupeKey('ab', 200, 'cd')).not.toBe(dedupeKey('abcd', 200, ''));
	});
});

describe('joinReferrersForNote', () => {
	it('returns an empty string for an empty Set', () => {
		expect(joinReferrersForNote(new Set())).toBe('');
	});

	it('joins all URLs with newlines when they fit under the cap', () => {
		const set = new Set(['https://a.example/', 'https://b.example/']);
		expect(joinReferrersForNote(set, 100)).toBe('https://a.example/\nhttps://b.example/');
	});

	it('truncates with "... and N more" when the URL list exceeds the cap', () => {
		const set = new Set(['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']);
		// "aaaa" (4) + "\nbbbb" (5) = 9 used. Adding "\ncccc" would push to 14 (>12).
		expect(joinReferrersForNote(set, 12)).toBe('aaaa\nbbbb\n... and 3 more');
	});

	it('reports "... and N more" with N counting every URL that did not fit', () => {
		const set = new Set(['aaa', 'bbb', 'ccc']);
		// "aaa" (3) used. Adding "\nbbb" would push to 7 (>4).
		// remaining = 3 - 2 + 1 = 2 (bbb and ccc).
		expect(joinReferrersForNote(set, 4)).toBe('aaa\n... and 2 more');
	});

	it('handles the case where the very first URL already exceeds the cap', () => {
		const set = new Set(['toolong']);
		expect(joinReferrersForNote(set, 3)).toBe('... and 1 more');
	});

	it('uses NOTE_MAX_LENGTH by default', () => {
		// Build a set whose total length comfortably fits within the default cap.
		const set = new Set(['x', 'y', 'z']);
		expect(joinReferrersForNote(set)).toBe('x\ny\nz');
		expect(NOTE_MAX_LENGTH).toBeGreaterThan(1000);
	});
});

/**
 * Builds a minimal {@link DedupeEntry} for use in pure-function tests.
 * Callers can override any field; the defaults represent a finished
 * "single successful HTTP request" without query parameters.
 * @param overrides - Fields to override on the default entry.
 */
function makeEntry(overrides: Partial<DedupeEntry> = {}): DedupeEntry {
	return {
		canonical: 'https://x.example/',
		status: 200,
		statusText: 'OK',
		contentType: 'text/plain',
		contentLengthMin: 0,
		contentLengthMax: 0,
		count: 1,
		referrers: new Set(),
		paramValues: new Map(),
		...overrides,
	};
}

describe('formatContentLength', () => {
	it('returns null when contentLengthMin is null', () => {
		expect(
			formatContentLength(makeEntry({ contentLengthMin: null, contentLengthMax: null })),
		).toBeNull();
	});

	it('returns the single number when min and max match', () => {
		expect(
			formatContentLength(makeEntry({ contentLengthMin: 500, contentLengthMax: 500 })),
		).toBe(500);
	});

	it('returns "min-max" when min and max differ', () => {
		expect(
			formatContentLength(makeEntry({ contentLengthMin: 100, contentLengthMax: 900 })),
		).toBe('100-900');
	});

	it('treats min=0 distinct from null (returns 0)', () => {
		expect(
			formatContentLength(makeEntry({ contentLengthMin: 0, contentLengthMax: 0 })),
		).toBe(0);
	});
});

describe('formatQueryPattern', () => {
	it('returns null when no query parameters were recorded', () => {
		expect(formatQueryPattern(makeEntry({ paramValues: new Map() }))).toBeNull();
	});

	it('renders each key as "key=N" using the unique value count', () => {
		const paramValues = new Map([
			['a', { values: new Set(['1', '2', '3']), overflowedCount: 0 }],
			['b', { values: new Set(['only']), overflowedCount: 0 }],
		]);
		expect(formatQueryPattern(makeEntry({ paramValues }))).toBe('a=3, b=1');
	});

	it('sorts keys alphabetically so the output matches the canonical URL order', () => {
		const paramValues = new Map([
			['z', { values: new Set(['x']), overflowedCount: 0 }],
			['a', { values: new Set(['y']), overflowedCount: 0 }],
			['m', { values: new Set(['w']), overflowedCount: 0 }],
		]);
		expect(formatQueryPattern(makeEntry({ paramValues }))).toBe('a=1, m=1, z=1');
	});

	it('does not append "+" at sample-set capacity when no observation overflowed', () => {
		const exactlyFullValues = new Set<string>();
		for (let i = 0; i < MAX_PARAM_VALUE_SAMPLES; i++) {
			exactlyFullValues.add(`v${i}`);
		}
		const paramValues = new Map([
			['exact', { values: exactlyFullValues, overflowedCount: 0 }],
		]);
		expect(formatQueryPattern(makeEntry({ paramValues }))).toBe(
			`exact=${MAX_PARAM_VALUE_SAMPLES}`,
		);
	});

	it('appends "+" once at least one observation is rejected by the full sample set', () => {
		const cappedValues = new Set<string>();
		for (let i = 0; i < MAX_PARAM_VALUE_SAMPLES; i++) {
			cappedValues.add(`v${i}`);
		}
		const paramValues = new Map([
			['overflow', { values: cappedValues, overflowedCount: 1 }],
		]);
		expect(formatQueryPattern(makeEntry({ paramValues }))).toBe(
			`overflow=${MAX_PARAM_VALUE_SAMPLES}+`,
		);
	});

	it('does NOT append "+" when duplicates were observed but the sample set still had capacity', () => {
		// Duplicate observation while there is still room in the set
		// must not be counted as overflow. The set silently absorbs the
		// duplicate; overflowedCount stays 0.
		const paramValues = new Map([
			['repeat', { values: new Set(['only']), overflowedCount: 0 }],
		]);
		expect(formatQueryPattern(makeEntry({ paramValues }))).toBe('repeat=1');
	});
});

describe('createResources (dedupe mode) — Query Pattern', () => {
	it('Query Pattern セルは query string がない resource では空になる', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(createMockResource({ url: 'https://x.com/static.css' }));
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][7])).toBe('');
	});

	it('単一値しか観測されないキーは "key=1" として表示', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/track?id=1&v=2' }),
		);
		await sheet.eachResource!(
			createMockResource({ url: 'https://x.com/track?id=1&v=2' }),
		);
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][7])).toBe('id=1, v=1');
	});

	it('複数値が観測されたキーは "key=N" としてユニーク値数を表示', async () => {
		const sheet = createResources({ dedupe: true })([]);
		await sheet.eachResource!(createMockResource({ url: 'https://x.com/t?id=1' }));
		await sheet.eachResource!(createMockResource({ url: 'https://x.com/t?id=2' }));
		await sheet.eachResource!(createMockResource({ url: 'https://x.com/t?id=3' }));
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][7])).toBe('id=3');
	});

	it('exactly MAX_PARAM_VALUE_SAMPLES distinct values: no "+" (cap reached but nothing lost)', async () => {
		const sheet = createResources({ dedupe: true })([]);
		for (let i = 0; i < MAX_PARAM_VALUE_SAMPLES; i++) {
			await sheet.eachResource!(
				createMockResource({ url: `https://x.com/t?id=value-${i}` }),
			);
		}
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][7])).toBe(`id=${MAX_PARAM_VALUE_SAMPLES}`);
	});

	it('exactly MAX_PARAM_VALUE_SAMPLES + 1 distinct values: "+" appended (first overflow)', async () => {
		const sheet = createResources({ dedupe: true })([]);
		for (let i = 0; i < MAX_PARAM_VALUE_SAMPLES + 1; i++) {
			await sheet.eachResource!(
				createMockResource({ url: `https://x.com/t?id=value-${i}` }),
			);
		}
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][7])).toBe(`id=${MAX_PARAM_VALUE_SAMPLES}+`);
	});

	it('large overshoot still shows "key=MAX+"', async () => {
		const sheet = createResources({ dedupe: true })([]);
		for (let i = 0; i < MAX_PARAM_VALUE_SAMPLES + 50; i++) {
			await sheet.eachResource!(
				createMockResource({ url: `https://x.com/t?id=value-${i}` }),
			);
		}
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][7])).toBe(`id=${MAX_PARAM_VALUE_SAMPLES}+`);
	});

	it('a duplicate value observed AFTER the cap still appends "+" (sample set lost resolution)', async () => {
		const sheet = createResources({ dedupe: true })([]);
		// Fill the sample set with distinct values
		for (let i = 0; i < MAX_PARAM_VALUE_SAMPLES; i++) {
			await sheet.eachResource!(
				createMockResource({ url: `https://x.com/t?id=value-${i}` }),
			);
		}
		// Now observe a duplicate of value-0 — the sample set has no
		// room, so this counts as an overflow even though the value is
		// already present.
		await sheet.eachResource!(createMockResource({ url: 'https://x.com/t?id=value-0' }));
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][7])).toBe(`id=${MAX_PARAM_VALUE_SAMPLES}+`);
	});

	it('duplicates observed BEFORE the cap do not trigger "+"', async () => {
		// Sample set has plenty of room. Observing the same value 50
		// times must keep the unique count at 1 and overflowedCount at 0.
		const sheet = createResources({ dedupe: true })([]);
		for (let i = 0; i < 50; i++) {
			await sheet.eachResource!(createMockResource({ url: 'https://x.com/t?id=same' }));
		}
		const rows = await sheet.finalizeResources!();

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][7])).toBe('id=1');
	});
});
