import type { CreateSheet } from '../sheets/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import {
	getResourceReferrerUrlsByResourceIds,
	streamAllResourcesRaw,
} from '@nitpicker/query';

import { reportLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { canonicalizeUrl, extractQueryPairs } from '../utils/canonicalize-url.js';
import { joinUrlsForNote } from '../utils/join-urls-for-note.js';
import { naturalCompare } from '../utils/sort-resources-by-url.js';

/**
 * Options for the {@link createResources} factory.
 */
export interface CreateResourcesOptions {
	/**
	 * Collapse raw resource rows that share the same canonical URL
	 * (query *values* stripped, query *keys* sorted) into one row per
	 * `(canonical URL, status, contentType)` combination. Adds a `Count`
	 * column showing how many raw resources each row collapses.
	 *
	 * Path-embedded identifiers (e.g. tracking IDs in
	 * `/pagead/viewthroughconversion/<id>/`) are preserved, so the
	 * aggregated rows still expose every tracker present in the archive.
	 *
	 * Defaults to `false` (raw mode — one row per raw resource URL).
	 */
	readonly dedupe?: boolean;
}

const RAW_HEADERS = [
	'URL',
	'Status Code',
	'Status Text',
	'Content Type',
	'Content Length',
	'Referrers',
] as const;

const DEDUPE_HEADERS = [
	'URL',
	'Status Code',
	'Status Text',
	'Content Type',
	'Content Length',
	'Referrers',
	'Count',
	'Query Pattern',
] as const;

/**
 * Maximum number of unique values to keep per query parameter key in
 * dedupe mode. The Query Pattern cell only shows unique counts, but
 * we keep a small sample for cell notes and to avoid unbounded memory
 * growth on trackers that send a unique-per-request value
 * (e.g. session IDs).
 */
export const MAX_PARAM_VALUE_SAMPLES = 100;

/**
 * Per-key tracker for query parameter values inside a dedupe entry.
 * `values` is capped at {@link MAX_PARAM_VALUE_SAMPLES}; once the cap
 * is reached, further observations increment `overflowedCount`
 * instead of growing the set. {@link formatQueryPattern} uses
 * `overflowedCount > 0` as the precise condition for appending `+`
 * to the cell — so `key=100` means "exactly 100 sampled, no
 * observation was lost", and `key=100+` means "the sample set lost
 * at least one observation after the cap".
 */
export interface ParamValueTracker {
	/** Sampled unique values (bounded by {@link MAX_PARAM_VALUE_SAMPLES}). */
	readonly values: Set<string>;
	/** Observations that arrived after the sample set was full and therefore could not enter the set. */
	overflowedCount: number;
}

/**
 * In-memory aggregation entry for dedupe mode. One per
 * `(canonical, status, contentType)` combination.
 */
export interface DedupeEntry {
	/** Canonical URL representing this entry. */
	readonly canonical: string;
	/** HTTP status code shared by all raw resources in this entry. */
	readonly status: number | null;
	/** HTTP status text — first non-null value observed. */
	statusText: string | null;
	/** Content type shared by all raw resources in this entry. */
	readonly contentType: string | null;
	/** Smallest non-null content length observed. */
	contentLengthMin: number | null;
	/** Largest non-null content length observed. */
	contentLengthMax: number | null;
	/** Number of raw resources collapsed into this entry. */
	count: number;
	/** Union of referrer page URLs across all raw resources in this entry. */
	readonly referrers: Set<string>;
	/** Per-query-key value trackers; absent for resources without a query string. */
	readonly paramValues: Map<string, ParamValueTracker>;
}

/**
 * Field separator and `null` marker used in {@link dedupeKey}. Both
 * are non-printable ASCII control characters that cannot appear in
 * an HTTP status code, `Content-Type`, or any URL we pull out of the
 * archive — so they are safe to use as in-band sentinels.
 */
const DEDUPE_KEY_SEP = String.fromCodePoint(1);
const DEDUPE_KEY_NULL = String.fromCodePoint(2);

/**
 * Builds the Map key for a dedupe entry.
 *
 * Concatenates `status`, `contentType`, and `canonical` with a
 * non-printable separator. A dedicated `null` marker keeps `null`
 * distinct from `''` for `contentType`, and from `0` for `status`,
 * so e.g. `(canonical, 200, null)` and `(canonical, 200, '')` land
 * in different aggregation buckets.
 *
 * String concatenation is used instead of {@link JSON.stringify}
 * because this function is called once per raw resource — on a
 * million-resource archive `JSON.stringify` allocated roughly a
 * million transient `SeqString`s, dominating Phase 3 wall-clock
 * time. Plain concatenation is several times faster and produces
 * the same collision-free key.
 * @param canonical - The canonicalized URL.
 * @param status - HTTP status code (nullable).
 * @param contentType - HTTP content type (nullable).
 */
export function dedupeKey(
	canonical: string,
	status: number | null,
	contentType: string | null,
): string {
	const statusPart = status === null ? DEDUPE_KEY_NULL : String(status);
	const contentTypePart = contentType === null ? DEDUPE_KEY_NULL : contentType;
	return statusPart + DEDUPE_KEY_SEP + contentTypePart + DEDUPE_KEY_SEP + canonical;
}

/**
 * Records a single `(key, value)` pair from a raw resource URL into
 * the entry's per-key value tracker. New keys allocate a tracker; the
 * value Set stops growing past {@link MAX_PARAM_VALUE_SAMPLES}, after
 * which subsequent observations increment `overflowedCount` so
 * {@link formatQueryPattern} can detect lost resolution and append `+`.
 * @param entry - The dedupe entry to merge into.
 * @param key - The query parameter key.
 * @param value - The raw value substring (already extracted, not decoded).
 */
function recordParamValue(entry: DedupeEntry, key: string, value: string): void {
	let tracker = entry.paramValues.get(key);
	if (!tracker) {
		tracker = { values: new Set<string>(), overflowedCount: 0 };
		entry.paramValues.set(key, tracker);
	}
	if (tracker.values.has(value)) {
		// Already sampled — a repeat observation of a known value, not a
		// lost one, so it must not count toward `overflowedCount`.
		return;
	}
	if (tracker.values.size < MAX_PARAM_VALUE_SAMPLES) {
		tracker.values.add(value);
	} else {
		tracker.overflowedCount++;
	}
}

/**
 * Formats the Query Pattern cell for a dedupe entry. Each tracked key
 * gets a `key=N` token where `N` is the number of distinct values
 * sampled. `+` is appended only when {@link ParamValueTracker.overflowedCount}
 * is non-zero — i.e. when at least one observation arrived after the
 * sample set was already full. Duplicate observations that arrive
 * while the sample set still has capacity do NOT trigger `+`.
 *
 * This gives precise semantics:
 *
 * - `key=1` — exactly one distinct value, seen any number of times
 * - `key=99` — 99 distinct values, sample set still had room
 * - `key=100` — exactly 100 distinct values, no observation lost
 * - `key=100+` — sample set was capped and at least one further
 *   observation could not be recorded (real cardinality unknown but
 *   at least 100)
 *
 * Keys are sorted alphabetically to match the canonical URL.
 *
 * Returns `null` for entries without any query parameters so the cell
 * appears empty in Google Sheets.
 * @param entry - The dedupe entry to format.
 */
export function formatQueryPattern(entry: DedupeEntry): string | null {
	if (entry.paramValues.size === 0) {
		return null;
	}
	const keys = [...entry.paramValues.keys()].toSorted();
	const parts: string[] = [];
	for (const key of keys) {
		const tracker = entry.paramValues.get(key)!;
		const overflowed = tracker.overflowedCount > 0;
		parts.push(`${key}=${tracker.values.size}${overflowed ? '+' : ''}`);
	}
	return parts.join(', ');
}

/**
 * Formats the Content Length cell value. Returns a single number when
 * every raw resource in the group reported the same size, a `min-max`
 * string when the size varies, or `null` when nothing was recorded.
 * @param entry - The dedupe entry to format.
 */
export function formatContentLength(entry: DedupeEntry): number | string | null {
	if (entry.contentLengthMin == null) {
		return null;
	}
	if (entry.contentLengthMin === entry.contentLengthMax) {
		return entry.contentLengthMin;
	}
	return `${entry.contentLengthMin}-${entry.contentLengthMax}`;
}

/**
 * Builds the cell row representation of a dedupe entry.
 * @param entry - The dedupe entry to serialize.
 */
function dedupeEntryToRow(entry: DedupeEntry) {
	return [
		createCellData({ value: entry.canonical }, defaultCellFormat),
		createCellData({ value: entry.status }, defaultCellFormat),
		createCellData({ value: entry.statusText }, defaultCellFormat),
		createCellData({ value: entry.contentType }, defaultCellFormat),
		createCellData({ value: formatContentLength(entry) }, defaultCellFormat),
		createCellData(
			{
				value: `${entry.referrers.size} pages`,
				note: joinUrlsForNote(entry.referrers),
			},
			defaultCellFormat,
		),
		createCellData({ value: entry.count }, defaultCellFormat),
		createCellData({ value: formatQueryPattern(entry) }, defaultCellFormat),
	];
}

/**
 * Updates an existing dedupe entry with another raw resource that
 * resolved to the same `(canonical, status, contentType)` key. Encapsulates
 * the "first non-null" / "min-max" merge rules so they live in a single
 * inspectable function.
 * @param entry - The existing entry being merged into.
 * @param resource - The new raw resource being folded into the entry.
 * @param resource.statusText
 * @param resource.contentLength
 */
function mergeIntoEntry(
	entry: DedupeEntry,
	resource: { statusText: string | null; contentLength: number | null },
): void {
	if (entry.statusText == null && resource.statusText != null) {
		entry.statusText = resource.statusText;
	}
	const len = resource.contentLength;
	if (len != null) {
		if (entry.contentLengthMin == null || len < entry.contentLengthMin) {
			entry.contentLengthMin = len;
		}
		if (entry.contentLengthMax == null || len > entry.contentLengthMax) {
			entry.contentLengthMax = len;
		}
	}
}

/**
 * Counts every `resource_items` row, for `estimateRowCount()`.
 * @param accessor - The archive accessor to query.
 */
async function countResources(accessor: ArchiveAccessor): Promise<number> {
	const knex = accessor.getKnex();
	const [row] = await knex('resource_items').count<{ count: string | number }[]>({
		count: '*',
	});
	return Number(row?.count ?? 0);
}

/**
 * Creates the "Resources" sheet configuration factory.
 *
 * Lists all network resources (CSS, JS, images, fonts, tracking pixels,
 * etc.) discovered during crawling. Two modes are supported:
 *
 * - **Raw mode** (default): one row per raw resource URL. Six columns:
 *   URL, Status Code, Status Text, Content Type, Content Length,
 *   Referrers. Matches historical behavior.
 * - **Dedupe mode** (`{ dedupe: true }`): collapses rows that share the
 *   same canonical URL (query values stripped, keys sorted) into one
 *   row per `(canonical URL, status, contentType)`. Adds a trailing
 *   `Count` column showing how many raw resources each row collapses.
 *   Useful when third-party tracking pixels generate millions of
 *   per-request unique URLs that would otherwise exceed the Google
 *   Sheets 10M-cell document limit.
 *
 * Both modes stream `streamAllResourcesRaw` once. Raw mode sends a row per
 * chunk item immediately; dedupe mode accumulates into `entries` while
 * streaming and only sends rows once, after the full scan, sorted by
 * canonical URL — the aggregated output (tens of thousands of rows) is
 * orders of magnitude smaller than the raw input (potentially millions),
 * so sorting after aggregation is far cheaper than sorting the raw stream.
 * @param options - Optional configuration. See {@link CreateResourcesOptions}.
 */
export function createResources(options?: CreateResourcesOptions): CreateSheet {
	const dedupe = options?.dedupe === true;

	return (_reports, accessor) => {
		if (!dedupe) {
			return {
				name: 'Resources',
				createHeaders: () => [...RAW_HEADERS],
				estimateRowCount: () => countResources(accessor),
				async run({ sheet, maxRows, estimatedTotal, onProgress }) {
					let sent = 0;
					const total = estimatedTotal;
					for await (const chunk of streamAllResourcesRaw(accessor)) {
						const referrerUrlsByResourceId = await getResourceReferrerUrlsByResourceIds(
							accessor,
							chunk.map((row) => row.resourceId),
						);
						for (const row of chunk) {
							if (sent >= maxRows) {
								await sheet.flush();
								return;
							}
							const referrerUrls = referrerUrlsByResourceId.get(row.resourceId) ?? [];
							await sheet.appendRow([
								createCellData({ value: row.url }, defaultCellFormat),
								createCellData({ value: row.status }, defaultCellFormat),
								createCellData({ value: row.statusText }, defaultCellFormat),
								createCellData({ value: row.contentType }, defaultCellFormat),
								createCellData({ value: row.contentLength }, defaultCellFormat),
								createCellData(
									{
										value: `${referrerUrls.length} pages`,
										note: joinUrlsForNote(referrerUrls),
									},
									defaultCellFormat,
								),
							]);
							sent++;
							onProgress(sent, total);
						}
					}
					await sheet.flush();
				},
			};
		}

		return {
			name: 'Resources',
			createHeaders: () => [...DEDUPE_HEADERS],
			estimateRowCount: () => countResources(accessor),
			async run({ sheet, maxRows, onProgress }) {
				const entries = new Map<string, DedupeEntry>();
				for await (const chunk of streamAllResourcesRaw(accessor)) {
					const referrerUrlsByResourceId = await getResourceReferrerUrlsByResourceIds(
						accessor,
						chunk.map((row) => row.resourceId),
					);
					for (const row of chunk) {
						// A blob-routed resource (identity is a large `data:` URI, not a
						// URL — see `create-entity-tables.ts`'s `resource_items url /
						// blob mutual-exclusion CHECK`) has `url === null`; group all
						// such resources under one degenerate empty-string key rather
						// than crashing the report.
						const canonical = canonicalizeUrl(row.url ?? '');
						const key = dedupeKey(canonical, row.status, row.contentType);
						let entry = entries.get(key);
						if (entry) {
							mergeIntoEntry(entry, row);
						} else {
							entry = {
								canonical,
								status: row.status,
								statusText: row.statusText,
								contentType: row.contentType,
								contentLengthMin: row.contentLength,
								contentLengthMax: row.contentLength,
								count: 0,
								referrers: new Set<string>(),
								paramValues: new Map<string, ParamValueTracker>(),
							};
							entries.set(key, entry);
						}
						entry.count++;

						for (const { key: paramKey, value } of extractQueryPairs(row.url ?? '')) {
							recordParamValue(entry, paramKey, value);
						}

						reportLog(`Read: Resource referrers (Search: ${row.url})`);
						const referrerUrls = referrerUrlsByResourceId.get(row.resourceId) ?? [];
						for (const referrerUrl of referrerUrls) {
							entry.referrers.add(referrerUrl);
						}
					}
				}

				reportLog(`Dedupe complete: ${entries.size} canonical group(s) accumulated`);
				const sortedEntries = [...entries.values()].toSorted((a, b) =>
					naturalCompare(a.canonical, b.canonical),
				);
				let sent = 0;
				// Unlike raw mode, the true total is already known here — the
				// aggregated output is much smaller than `estimateRowCount()`'s
				// raw (pre-dedupe) resource count, so that estimate would
				// understate progress rather than overstate it.
				const total = Math.min(sortedEntries.length, maxRows);
				for (const entry of sortedEntries) {
					if (sent >= maxRows) {
						break;
					}
					await sheet.appendRow(dedupeEntryToRow(entry));
					sent++;
					onProgress(sent, total);
				}
				await sheet.flush();
			},
		};
	};
}
