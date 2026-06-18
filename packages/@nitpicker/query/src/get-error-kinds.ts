import type { ErrorKindGroup, ErrorKindsResult } from './types.js';
import type { ArchiveAccessor, ErrorKind } from '@nitpicker/crawler';

import { classifyErrorKind } from '@nitpicker/crawler';

import { readCrawlErrors } from './read-crawl-errors.js';
import { readErrorLog } from './read-error-log.js';
import { readPageErrors } from './read-page-errors.js';

/** Upper bound on representative URLs kept per {@link ErrorKindGroup}. */
const MAX_SAMPLE_URLS = 50;

/** Mutable accumulator for a single {@link ErrorKind} while aggregating. */
interface KindAccumulator {
	/** Total records classified into this kind. */
	count: number;
	/** host → count. */
	hosts: Map<string, number>;
	/** Capped representative URLs. */
	sampleUrls: string[];
}

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
 * Classify and aggregate every recorded crawl failure by cause.
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
 * Counts are per failure record (a URL that failed on several presets or phases
 * contributes multiple records); use the per-host breakdown and sample URLs to
 * drill into a kind.
 * @param accessor - The opened archive accessor.
 * @returns Per-kind counts, host breakdown, and sample URLs, sorted by count.
 * @example
 * ```ts
 * const { groups } = await getErrorKinds(accessor);
 * const dns = groups.find((g) => g.kind === 'dns');
 * console.log(dns?.count, dns?.hosts);
 * ```
 */
export async function getErrorKinds(
	accessor: ArchiveAccessor,
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
	let channelSource: ErrorKindsResult['channelSource'] =
		channelRecords.length > 0 ? 'crawl_errors' : 'none';
	if (channelRecords.length === 0) {
		const logRecords = await readErrorLog(accessor.tmpDir);
		if (logRecords.length > 0) {
			channelRecords = logRecords;
			channelSource = 'error.log';
		}
	}

	const accumulators = new Map<ErrorKind, KindAccumulator>();
	let total = 0;
	for (const { url, message } of [...pageRecords, ...channelRecords]) {
		const kind = classifyErrorKind(message);
		let acc = accumulators.get(kind);
		if (!acc) {
			acc = { count: 0, hosts: new Map(), sampleUrls: [] };
			accumulators.set(kind, acc);
		}
		acc.count++;
		total++;
		const host = hostOf(url);
		acc.hosts.set(host, (acc.hosts.get(host) ?? 0) + 1);
		if (url && acc.sampleUrls.length < MAX_SAMPLE_URLS) {
			acc.sampleUrls.push(url);
		}
	}

	const groups: ErrorKindGroup[] = [...accumulators.entries()]
		.map(([kind, acc]) => ({
			kind,
			count: acc.count,
			hosts: [...acc.hosts.entries()]
				.map(([host, count]) => ({ host, count }))
				.toSorted((a, b) => b.count - a.count),
			sampleUrls: acc.sampleUrls,
		}))
		.toSorted((a, b) => b.count - a.count);

	return { total, channelSource, groups };
}
