import type { Knex } from 'knex';

import { getResourceReferrerEdges } from '../get-resource-referrer-edges.js';

import { canonicalizeUrlWithQueryPairs } from './canonicalize-url-with-query-pairs.js';
import { naturalCompare } from './sort-resources-by-url.js';

/** `resource_items` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 5000;

/**
 * Maximum number of sample referrer page URLs kept (and shown in the
 * report's cell note) per group. `referrer_count` itself is never capped —
 * see {@link ResourceGroupAccumulator.referrerPageIds}'s docs.
 */
const MAX_REFERRER_NOTE_SAMPLES = 200;

/**
 * Maximum number of unique values kept per query parameter key. Mirrors
 * `report-google-sheets`' historical `MAX_PARAM_VALUE_SAMPLES`: a tracker
 * that sends a unique-per-request value (session IDs) has unbounded
 * cardinality with no natural finite bound the way referring pages do, so a
 * sample + overflow counter is the only sane approach here.
 */
const MAX_PARAM_VALUE_SAMPLES = 100;

/** Per-key tracker for query parameter values inside a resource group. */
interface ParamValueTracker {
	readonly values: Set<string>;
	overflowedCount: number;
}

/** Field separator and `null` marker for the in-memory dedupe key. */
const DEDUPE_KEY_SEP = String.fromCodePoint(1);
const DEDUPE_KEY_NULL = String.fromCodePoint(2);

/**
 * In-memory aggregation entry for one `(canonical URL, status, contentType)`
 * resource group, accumulated across the whole `resource_items` scan.
 */
interface ResourceGroupAccumulator {
	readonly canonicalUrl: string;
	readonly status: number | null;
	statusText: string | null;
	readonly contentType: string | null;
	contentLengthMin: number | null;
	contentLengthMax: number | null;
	count: number;
	/**
	 * Every distinct referring page id, for an exact `referrer_count`.
	 * Uses `page_id` (a small integer already assigned by the archive)
	 * rather than referrer URL strings: the set of pages that can
	 * reference a resource is bounded by the archive's own (finite,
	 * already-known) page count, unlike {@link paramValues}' per-request
	 * tracker values, which have no such bound. A resource referenced by
	 * every page on a 500K-page site costs ~4MB here, not the tens of MB a
	 * `Set<string>` of full URLs would.
	 */
	readonly referrerPageIds: Set<number>;
	/** Sample referrer URLs for the note, capped at {@link MAX_REFERRER_NOTE_SAMPLES}. */
	readonly referrerUrlSamples: string[];
	readonly paramValues: Map<string, ParamValueTracker>;
}

/** One row to insert into `viewer_resource_groups`. */
export interface ResourceGroupInsertRow {
	canonical_url: string;
	status: number | null;
	status_text: string | null;
	content_type: string | null;
	content_length_min: number | null;
	content_length_max: number | null;
	count: number;
	referrer_count: number;
	referrer_note: string | null;
	query_pattern: string | null;
}

/**
 * Builds the in-memory Map key for a resource group. Concatenates `status`,
 * `contentType`, and `canonicalUrl` with a non-printable separator, with a
 * dedicated `null` marker to keep `null` distinct from `''`/`0`. Mirrors
 * `report-google-sheets`' historical `dedupeKey` (string concatenation, not
 * `JSON.stringify`, to avoid allocating a transient string per resource on
 * a million-resource archive).
 * @param canonicalUrl - The canonicalized URL.
 * @param status - HTTP status code (nullable).
 * @param contentType - Raw `Content-Type` header value (nullable).
 */
function resourceGroupKey(
	canonicalUrl: string,
	status: number | null,
	contentType: string | null,
): string {
	const statusPart = status === null ? DEDUPE_KEY_NULL : String(status);
	const contentTypePart = contentType === null ? DEDUPE_KEY_NULL : contentType;
	return statusPart + DEDUPE_KEY_SEP + contentTypePart + DEDUPE_KEY_SEP + canonicalUrl;
}

/**
 * Records a single `(key, value)` pair into a resource group's per-key
 * value tracker, capping each key's sample set at
 * {@link MAX_PARAM_VALUE_SAMPLES}.
 * @param paramValues - The group's `paramValues` map to update.
 * @param key - The query parameter key.
 * @param value - The raw value substring (already extracted, not decoded).
 */
function recordParamValue(
	paramValues: Map<string, ParamValueTracker>,
	key: string,
	value: string,
): void {
	let tracker = paramValues.get(key);
	if (!tracker) {
		tracker = { values: new Set<string>(), overflowedCount: 0 };
		paramValues.set(key, tracker);
	}
	if (tracker.values.has(value)) {
		return;
	}
	if (tracker.values.size < MAX_PARAM_VALUE_SAMPLES) {
		tracker.values.add(value);
	} else {
		tracker.overflowedCount++;
	}
}

/**
 * Formats the `query_pattern` column for a resource group: one `key=N`
 * token per tracked key, `+` appended when {@link ParamValueTracker.overflowedCount}
 * is non-zero. Returns `null` for a group with no query parameters.
 * @param paramValues - The group's per-key value trackers.
 */
function formatQueryPattern(
	paramValues: ReadonlyMap<string, ParamValueTracker>,
): string | null {
	if (paramValues.size === 0) {
		return null;
	}
	const keys = [...paramValues.keys()].toSorted();
	const parts = keys.map((key) => {
		const tracker = paramValues.get(key)!;
		return `${key}=${tracker.values.size}${tracker.overflowedCount > 0 ? '+' : ''}`;
	});
	return parts.join(', ');
}

/**
 * Computes `viewer_resource_groups` insert rows: one row per
 * `(canonical URL, status, contentType)` combination, folding every raw
 * `resource_items` row that shares that combination into a single group.
 *
 * Runs entirely at `viewer-build` time (unlike `computeResourceInsertRows`,
 * which streams `viewer_resources`/`viewer_resource_stats` insert rows
 * chunk-by-chunk): a canonical group's constituent raw resources can appear
 * anywhere across the whole `resource_items.id` range (e.g. a tracking
 * pixel's `?id=1` variant at a low id and its `?id=99999` variant at a high
 * one), so grouping requires the full scan before any row can be finalized
 * and inserted. The aggregated output (tens of thousands of groups) is
 * orders of magnitude smaller than the raw input (potentially millions),
 * matching the report-time predecessor this replaces
 * (`report-google-sheets`' `create-resources.ts` dedupe mode, moved here so
 * report runs stream precomputed rows instead of re-aggregating on every
 * run).
 *
 * For each `resource_items` chunk, a follow-up call to
 * `getResourceReferrerEdges` (the same join `report-export`'s
 * `getResourceReferrerUrlsByResourceIds` uses) resolves that chunk's
 * `resource_ref_edges` (referring `page_id` + URL) so referrer pages can be
 * merged into each group's {@link ResourceGroupAccumulator.referrerPageIds}
 * — the same two-step shape `computeAnchorFactRows` uses for per-page
 * tallies.
 * @param trx - An open Knex transaction (a plain `Knex` instance also works, e.g. in tests).
 * @param chunkSize - Maximum `resource_items` rows read per chunk. Must be positive.
 * @param onProgress - Called after each keyset chunk with the
 *   `resource_items.id` scanned up to so far and the max id (issue #294: on
 *   a large archive this scan runs for a while with no other signal it
 *   hasn't hung). Omit for no reporting (the default; e.g. tests).
 * @returns Insert rows for `viewer_resource_groups`, sorted by canonical URL
 *   in natural order (matching the report-time predecessor's output order).
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * const rows = await computeResourceGroupRows(trx);
 * await trx('viewer_resource_groups').insert(rows);
 */
export async function computeResourceGroupRows(
	trx: Knex,
	chunkSize = READ_CHUNK_SIZE,
	onProgress?: (scannedUpToId: number, maxId: number) => void,
): Promise<ResourceGroupInsertRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeResourceGroupRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	// MAX() over the keyset column is an O(1) index-tail read; only fetched
	// when someone is listening (mirrors `computeResourceInsertRows`).
	let maxId = 0;
	if (onProgress) {
		const [maxRow] = await trx('resource_items').max<{ max: number | null }[]>({
			max: 'id',
		});
		maxId = maxRow?.max ?? 0;
	}

	const entries = new Map<string, ResourceGroupAccumulator>();

	let lastId = 0;
	for (;;) {
		const rows: {
			id: number;
			url: string | null;
			status: number | null;
			statusText: string | null;
			contentType: string | null;
			contentLength: number | null;
		}[] = await trx('resource_items as ri')
			.leftJoin('url_refs as ur', 'ur.id', 'ri.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
			.where('ri.id', '>', lastId)
			.orderBy('ri.id', 'asc')
			.limit(chunkSize)
			.select(
				'ri.id as id',
				'ur.url as url',
				'ri.status as status',
				'ri.status_text as statusText',
				'ctr.raw as contentType',
				'ri.content_length as contentLength',
			);

		if (rows.length === 0) {
			onProgress?.(maxId, maxId);
			break;
		}
		lastId = rows.at(-1)!.id;
		onProgress?.(Math.min(lastId, maxId), maxId);

		const groupKeyByResourceId = new Map<number, string>();
		for (const row of rows) {
			// A blob-routed resource (identity is a large `data:` URI, not a
			// URL) has `url === null`; group all such resources under one
			// degenerate empty-string key, matching the report-time
			// predecessor's behavior.
			const { canonical, pairs } = canonicalizeUrlWithQueryPairs(row.url ?? '');
			const key = resourceGroupKey(canonical, row.status, row.contentType);
			let entry = entries.get(key);
			if (entry) {
				if (entry.statusText == null && row.statusText != null) {
					entry.statusText = row.statusText;
				}
				const len = row.contentLength;
				if (len != null) {
					if (entry.contentLengthMin == null || len < entry.contentLengthMin) {
						entry.contentLengthMin = len;
					}
					if (entry.contentLengthMax == null || len > entry.contentLengthMax) {
						entry.contentLengthMax = len;
					}
				}
			} else {
				entry = {
					canonicalUrl: canonical,
					status: row.status,
					statusText: row.statusText,
					contentType: row.contentType,
					contentLengthMin: row.contentLength,
					contentLengthMax: row.contentLength,
					count: 0,
					referrerPageIds: new Set<number>(),
					referrerUrlSamples: [],
					paramValues: new Map<string, ParamValueTracker>(),
				};
				entries.set(key, entry);
			}
			entry.count++;
			for (const { key: paramKey, value } of pairs) {
				recordParamValue(entry.paramValues, paramKey, value);
			}
			groupKeyByResourceId.set(row.id, key);
		}

		const chunkIds = rows.map((row) => row.id);
		const edgeRows = await getResourceReferrerEdges(trx, chunkIds);
		for (const edge of edgeRows) {
			const key = groupKeyByResourceId.get(edge.resourceId);
			if (key === undefined) {
				continue;
			}
			const entry = entries.get(key)!;
			if (!entry.referrerPageIds.has(edge.pageId)) {
				entry.referrerPageIds.add(edge.pageId);
				if (entry.referrerUrlSamples.length < MAX_REFERRER_NOTE_SAMPLES) {
					entry.referrerUrlSamples.push(edge.pageUrl);
				}
			}
		}
	}

	const sortedEntries = [...entries.values()].toSorted((a, b) =>
		naturalCompare(a.canonicalUrl, b.canonicalUrl),
	);
	return sortedEntries.map((entry) => ({
		canonical_url: entry.canonicalUrl,
		status: entry.status,
		status_text: entry.statusText,
		content_type: entry.contentType,
		content_length_min: entry.contentLengthMin,
		content_length_max: entry.contentLengthMax,
		count: entry.count,
		referrer_count: entry.referrerPageIds.size,
		referrer_note:
			entry.referrerUrlSamples.length > 0 ? entry.referrerUrlSamples.join('\n') : null,
		query_pattern: formatQueryPattern(entry.paramValues),
	}));
}
