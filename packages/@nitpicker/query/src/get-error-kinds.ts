import type { ErrorKind, ErrorKindGroup, ErrorKindsResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { classifyErrorKind } from './classify-error-kind.js';

/** Upper bound on representative URLs kept per {@link ErrorKindGroup}. */
const MAX_SAMPLE_URLS = 50;

/** One failure record before aggregation. */
interface ErrorRecord {
	/** URL the failure is about, or `null` when unknown / process-level. */
	url: string | null;
	/** Raw message used to classify the cause. */
	message: string;
}

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
 * Read scrape-path failures from `page_errors`, joined to `pages` for the URL.
 * Older archives may predate the table, so existence is checked first.
 * @param accessor - The opened archive accessor.
 * @returns Failure records (possibly empty).
 */
async function readPageErrors(accessor: ArchiveAccessor): Promise<ErrorRecord[]> {
	const knex = accessor.getKnex();
	if (!(await knex.schema.hasTable('page_errors'))) {
		return [];
	}
	const rows = await knex('page_errors as e')
		.leftJoin('pages as p', 'p.id', 'e.pageId')
		.select('p.url as url', 'e.message as message');
	return rows.map((r: { url: string | null; message: string }) => ({
		url: r.url ?? null,
		message: r.message,
	}));
}

/**
 * Parse `error.log` entries (`[pid(main)] <url> <message…>`) for archives that
 * predate the `crawl_errors` table. Only the first line of each entry is read —
 * the cause token lives there; stack-trace continuation lines are ignored.
 * @param tmpDir - The accessor's working directory holding `error.log`.
 * @returns Failure records, or empty when the log is missing.
 */
async function readErrorLog(tmpDir: string): Promise<ErrorRecord[]> {
	let text: string;
	try {
		text = await readFile(path.join(tmpDir, 'error.log'), 'utf8');
	} catch {
		return [];
	}
	const records: ErrorRecord[] = [];
	// Match only the `[pid(main|sub)] ` header, then split the remainder by hand:
	// a single regex with two greedy trailing groups (`(\S+)\s*(.*)`) is flagged
	// for super-linear backtracking, and slicing is both linear and clearer.
	const header = /^\[\d+\((?:main|sub)\)\]\s+/;
	for (const line of text.split('\n')) {
		const match = header.exec(line);
		if (!match) {
			continue;
		}
		const rest = line.slice(match[0].length);
		const spaceIndex = rest.indexOf(' ');
		const rawUrl = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex);
		records.push({
			url: rawUrl === 'null' || rawUrl === '' ? null : rawUrl,
			message: spaceIndex === -1 ? '' : rest.slice(spaceIndex + 1),
		});
	}
	return records;
}

/**
 * Read structured crawler-level failures from `crawl_errors`.
 * @param accessor - The opened archive accessor.
 * @returns Failure records.
 */
async function readCrawlErrors(accessor: ArchiveAccessor): Promise<ErrorRecord[]> {
	const knex = accessor.getKnex();
	const rows = await knex('crawl_errors').select('url', 'message');
	return rows.map((r: { url: string | null; message: string }) => ({
		url: r.url ?? null,
		message: r.message,
	}));
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
