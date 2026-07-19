import type { CreateSheet, CreateSheetSetting } from '../sheets/types.js';
import type { ArchiveResource as Resource } from '@nitpicker/crawler';

import { reportLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { canonicalizeUrl, extractQueryPairs } from '../utils/canonicalize-url.js';
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
 * Safety cap for the joined referrer URL list inserted into a cell note.
 * Google Sheets caps cell content / notes around 50,000 characters; we
 * truncate well below that to leave room for the "and N more" suffix.
 */
export const NOTE_MAX_LENGTH = 49_000;

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
 * Joins referrer URLs into a single newline-separated string, truncating
 * at `maxLength` to stay within Google Sheets' note size cap. When
 * truncated, appends a `... and N more` line where `N` counts every URL
 * that did not fit, including the one whose insertion would have
 * crossed the limit.
 * @param referrers - The set of unique referrer page URLs.
 * @param maxLength - Optional override for the character cap (defaults to {@link NOTE_MAX_LENGTH}).
 */
export function joinReferrersForNote(
	referrers: ReadonlySet<string>,
	maxLength: number = NOTE_MAX_LENGTH,
): string {
	const total = referrers.size;
	if (total === 0) {
		return '';
	}
	const kept: string[] = [];
	let used = 0;
	let seen = 0;
	for (const url of referrers) {
		seen++;
		const next = used + url.length + (kept.length > 0 ? 1 : 0);
		if (next > maxLength) {
			const remaining = total - seen + 1;
			kept.push(`... and ${remaining} more`);
			break;
		}
		kept.push(url);
		used = next;
	}
	return kept.join('\n');
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
				note: joinReferrersForNote(entry.referrers),
			},
			defaultCellFormat,
		),
		createCellData({ value: entry.count }, defaultCellFormat),
		createCellData({ value: formatQueryPattern(entry) }, defaultCellFormat),
	];
}

/**
 * Builds the cell row for a single raw resource (raw mode).
 * @param resource - The resource record from the archive.
 * @param referrers - The referrer URLs associated with the resource.
 */
function rawResourceToRow(resource: Resource, referrers: string[]) {
	return [
		createCellData({ value: resource.url }, defaultCellFormat),
		createCellData({ value: resource.status }, defaultCellFormat),
		createCellData({ value: resource.statusText }, defaultCellFormat),
		createCellData({ value: resource.contentType }, defaultCellFormat),
		createCellData({ value: resource.contentLength }, defaultCellFormat),
		createCellData(
			{
				value: `${referrers.length} pages`,
				note: referrers.join('\n'),
			},
			defaultCellFormat,
		),
	];
}

/**
 * Updates an existing dedupe entry with another raw resource that
 * resolved to the same `(canonical, status, contentType)` key. Encapsulates
 * the "first non-null" / "min-max" merge rules so they live in a single
 * inspectable function.
 * @param entry - The existing entry being merged into.
 * @param resource - The new raw resource being folded into the entry.
 */
function mergeIntoEntry(entry: DedupeEntry, resource: Resource): void {
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
 * In dedupe mode the factory accumulates state inside `eachResource`
 * and emits the aggregated rows once via the `finalizeResources` hook,
 * which Phase 3 calls exactly once after the per-resource loop completes.
 * @param options - Optional configuration. See {@link CreateResourcesOptions}.
 */
export function createResources(options?: CreateResourcesOptions): CreateSheet {
	const dedupe = options?.dedupe === true;

	return () => {
		if (!dedupe) {
			const setting: CreateSheetSetting = {
				name: 'Resources',
				createHeaders: () => [...RAW_HEADERS],
				async eachResource(resource) {
					reportLog(`Read: Resource referrers (Search: ${resource.url})`);
					const referrers = await resource.getReferrers();
					return [rawResourceToRow(resource, referrers)];
				},
			};
			return setting;
		}

		const entries = new Map<string, DedupeEntry>();

		const setting: CreateSheetSetting = {
			name: 'Resources',
			// Sorting the 1M+ raw resource list before aggregation is
			// wasted work: the 63K-row aggregated output is orders of
			// magnitude smaller, and we sort it inside finalizeResources
			// instead. This single flag flip turns a multi-minute sort
			// into a sub-second one on million-resource archives.
			skipSortResources: true,
			createHeaders: () => [...DEDUPE_HEADERS],
			async eachResource(resource) {
				// A blob-routed resource (identity is a large `data:` URI, not a
				// URL — see `create-entity-tables.ts`'s `resource_items url /
				// blob mutual-exclusion CHECK`) has `url === null`; group all
				// such resources under one degenerate empty-string key rather
				// than crashing the report.
				const canonical = canonicalizeUrl(resource.url ?? '');
				const key = dedupeKey(canonical, resource.status, resource.contentType);
				let entry = entries.get(key);
				if (entry) {
					mergeIntoEntry(entry, resource);
				} else {
					entry = {
						canonical,
						status: resource.status,
						statusText: resource.statusText,
						contentType: resource.contentType,
						contentLengthMin: resource.contentLength,
						contentLengthMax: resource.contentLength,
						count: 0,
						referrers: new Set<string>(),
						paramValues: new Map<string, ParamValueTracker>(),
					};
					entries.set(key, entry);
				}
				entry.count++;

				for (const { key: paramKey, value } of extractQueryPairs(resource.url ?? '')) {
					recordParamValue(entry, paramKey, value);
				}

				reportLog(`Read: Resource referrers (Search: ${resource.url})`);
				const referrers = await resource.getReferrers();
				for (const ref of referrers) {
					entry.referrers.add(ref);
				}

				return null;
			},
			finalizeResources() {
				reportLog(`Dedupe complete: ${entries.size} canonical group(s) accumulated`);
				// Sort the aggregated entries by canonical URL in natural
				// order. This is N=tens-of-thousands rather than the
				// millions in `entries`, so the cost is negligible
				// compared to sorting the raw list up front.
				const sortedEntries = [...entries.values()].toSorted((a, b) =>
					naturalCompare(a.canonical, b.canonical),
				);
				const rows = sortedEntries.map(dedupeEntryToRow);
				entries.clear();
				return rows;
			},
		};
		return setting;
	};
}
