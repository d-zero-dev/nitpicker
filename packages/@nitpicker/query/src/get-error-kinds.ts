import type { ErrorKindEntry, ErrorKindsResult, GetErrorKindsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { classifyErrorKind } from '@nitpicker/crawler';

import { readCrawlErrors } from './read-crawl-errors.js';
import { readErrorLog } from './read-error-log.js';
import { readPageErrors } from './read-page-errors.js';
import { resolveErrorKindsSort } from './resolve-error-kinds-sort.js';
import { sortArrayItems } from './sort-array-items.js';

/** Upper bound on representative URLs kept per {@link ErrorKindEntry}. */
const MAX_SAMPLE_URLS = 50;

/**
 * Extract the hostname from a URL string, or a sentinel when it is absent or
 * unparsable — keeps host aggregation total without throwing on odd inputs.
 * @param url - The URL string, possibly `null`.
 * @returns The hostname, `(unknown)` for `null`, or `(invalid)` when parsing fails.
 */
function hostOf(url: string | null): string {
	if (!url) {
		return '(unknown)';
	}
	try {
		return new URL(url).host || '(invalid)';
	} catch {
		return '(invalid)';
	}
}

/**
 * Classify and aggregate every recorded crawl failure by cause, normalized to
 * one row per host×kind pair.
 *
 * Merges two sources: scrape-path failures (`page_errors`), and the
 * crawler-level `error` channel taken from `crawl_errors` when it has rows, or
 * parsed from `error.log` when it does not (so archives crawled before
 * structured capture — including ones a migration left with an empty
 * `crawl_errors` table — still classify). Each record's cause is derived with
 * {@link classifyErrorKind} — nothing is read from a stored `kind`, so the same
 * archive always classifies the same way regardless of when it was crawled.
 *
 * Known limitation: re-crawling a pre-capture archive (resume / append) writes
 * the new run's errors into `crawl_errors`, which then shadows `error.log`; the
 * original run's `error`-channel entries (still only in `error.log`) are not
 * merged. Scrape-path (`page_errors`) history is unaffected.
 *
 * A single host is normally classified into exactly one kind, but the row is
 * keyed by (host, kind) rather than by host alone — a retried request can in
 * principle fail with a different cause on a later attempt, and normalizing
 * up front keeps that case from silently merging two distinct causes into one
 * row.
 * @param accessor - The opened archive accessor.
 * @param options - Filter, sort, and pagination options.
 * @returns Host×kind rows for the requested page, the matching row count, and
 *   archive-wide totals in `facets`.
 * @example
 * ```ts
 * const { items } = await getErrorKinds(accessor, { kind: 'dns', sortBy: 'count', sortOrder: 'desc' });
 * console.log(items[0]?.host, items[0]?.count);
 * ```
 */
export async function getErrorKinds(
	accessor: ArchiveAccessor,
	options: GetErrorKindsOptions = {},
): Promise<ErrorKindsResult> {
	const knex = accessor.getKnex();
	const hasCrawlErrors = await knex.schema.hasTable('crawl_errors');

	const pageRecords = await readPageErrors(accessor);

	// Prefer the structured table, but fall back to error.log whenever it yields
	// nothing — not just when the table is absent. A legacy (pre-capture) archive
	// opened in write mode (resume / append / a read-write query) gets an EMPTY
	// crawl_errors table created by migration; gating the fallback on table
	// absence alone would then read zero rows and silently drop every error that
	// still lives only in error.log. (Once the table has rows it is authoritative
	// and error.log is not re-read, so freshly captured errors are never
	// double-counted against their own error.log entries.)
	let channelRecords = hasCrawlErrors ? await readCrawlErrors(accessor) : [];
	let channelSource: ErrorKindsResult['facets']['channelSource'] =
		channelRecords.length > 0 ? 'crawl_errors' : 'none';
	if (channelRecords.length === 0) {
		const logRecords = await readErrorLog(accessor.tmpDir);
		if (logRecords.length > 0) {
			channelRecords = logRecords;
			channelSource = 'error.log';
		}
	}

	const accumulators = new Map<string, ErrorKindEntry>();
	let totalRecords = 0;
	for (const { url, message } of [...pageRecords, ...channelRecords]) {
		const kind = classifyErrorKind(message);
		const host = hostOf(url);
		const key = `${host} ${kind}`;
		let acc = accumulators.get(key);
		if (!acc) {
			acc = { host, kind, count: 0, sampleUrls: [], overflowedCount: 0 };
			accumulators.set(key, acc);
		}
		acc.count++;
		totalRecords++;
		if (url) {
			if (acc.sampleUrls.length < MAX_SAMPLE_URLS) {
				acc.sampleUrls.push(url);
			} else {
				acc.overflowedCount++;
			}
		}
	}

	let items = [...accumulators.values()];
	if (options.host) {
		items = items.filter((item) => item.host === options.host);
	}
	if (options.kind) {
		items = items.filter((item) => item.kind === options.kind);
	}

	const { sortBy, sortOrder } = resolveErrorKindsSort(options);
	items = sortArrayItems(items, sortBy, sortOrder, {
		host: { getValue: (item) => item.host },
		kind: { getValue: (item) => item.kind },
		count: { getValue: (item) => item.count },
	});

	const total = items.length;
	const offset = options.offset ?? 0;
	const limit = options.limit ?? items.length;

	return {
		items: items.slice(offset, offset + limit),
		total,
		facets: { totalRecords, channelSource },
	};
}
