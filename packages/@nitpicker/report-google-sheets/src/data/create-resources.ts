import type { CreateSheet, CreateSheetSetting } from '../sheets/types.js';
import type { ArchiveResource as Resource } from '@nitpicker/crawler';

import { reportLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { canonicalizeUrl } from '../utils/canonicalize-url.js';

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
] as const;

/**
 * Safety cap for the joined referrer URL list inserted into a cell note.
 * Google Sheets caps cell content / notes around 50,000 characters; we
 * truncate well below that to leave room for the "and N more" suffix.
 */
export const NOTE_MAX_LENGTH = 49_000;

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
}

/**
 * Builds the Map key for a dedupe entry.
 *
 * Uses {@link JSON.stringify} so that each field is serialized with a
 * type-faithful representation: `null` becomes `null`, the empty
 * string becomes `""`, numbers become bare digits, and arbitrary
 * URLs / content types are quoted. This makes the resulting key
 * collision-free for every combination of inputs the dedupe path
 * accepts — notably keeping `contentType=null` distinct from
 * `contentType=""` and `status=null` distinct from `status=0`.
 * @param canonical - The canonicalized URL.
 * @param status - HTTP status code (nullable).
 * @param contentType - HTTP content type (nullable).
 */
export function dedupeKey(
	canonical: string,
	status: number | null,
	contentType: string | null,
): string {
	return JSON.stringify([status, contentType, canonical]);
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
			createHeaders: () => [...DEDUPE_HEADERS],
			async eachResource(resource) {
				const canonical = canonicalizeUrl(resource.url);
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
					};
					entries.set(key, entry);
				}
				entry.count++;

				reportLog(`Read: Resource referrers (Search: ${resource.url})`);
				const referrers = await resource.getReferrers();
				for (const ref of referrers) {
					entry.referrers.add(ref);
				}

				return null;
			},
			finalizeResources() {
				reportLog(`Dedupe complete: ${entries.size} canonical group(s) accumulated`);
				const rows = [...entries.values()].map(dedupeEntryToRow);
				entries.clear();
				return rows;
			},
		};
		return setting;
	};
}
