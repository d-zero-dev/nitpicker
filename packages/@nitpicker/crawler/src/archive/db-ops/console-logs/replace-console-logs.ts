import type { WriteRefCaches } from '../_shared/types.js';
import type { ConsoleLogEntry } from '@d-zero/beholder';
import type { Knex } from 'knex';

import { upsertTextRefs } from '../../populate-entity-tables/upsert-text-refs.js';
import { resolveRedirectChain } from '../../resolve-redirect-chain.js';
import { clearWriteRefCaches } from '../_shared/clear-write-ref-caches.js';
import { resolveContentItemId } from '../_shared/resolve-content-item-id.js';
import { upsertJsonRef } from '../_shared/upsert-json-ref.js';
import { upsertUrlRef } from '../_shared/upsert-url-ref.js';

import { computeConsoleLogHash } from './compute-console-log-hash.js';
import { stringifyConsoleLogArgs } from './stringify-console-log-args.js';
import { upsertConsoleLogItem } from './upsert-console-log-item.js';

/** Rows sent per `INSERT INTO page_console_logs ... VALUES (...)` statement. */
const INSERT_CHUNK_SIZE = 500;

/**
 * Replaces one page's `page_console_logs` rows wholesale with a freshly
 * captured set of console messages / page errors (issue #228).
 *
 * Scoped-Replace, the same pattern as `replaceAnchorEdges` /
 * `replaceImageItems`: the page's existing rows are deleted and the new
 * set is inserted in the same transaction, so a re-scrape (`--append` /
 * `--retry-failed` / re-render) never accumulates duplicate occurrences.
 * Unlike those two, there is no non-empty guard on the DELETE here — the
 * caller (`Crawler#handleConsoleLogs`) already skips emitting the event
 * entirely when `entries` is empty, which is what keeps a degraded
 * re-scrape from wiping out a prior good capture.
 *
 * `pageUrl` is the originally-requested URL (matching `updatePage`'s
 * `page.url.withoutHashAndAuth` contract), not necessarily the page that
 * ends up holding the content: `resolveRedirectChain` derives the same
 * redirect destination `updatePage` writes content under, so console logs
 * attach to the row that actually carries the page's `page_meta`, not to
 * an empty placeholder for the pre-redirect URL.
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param pageUrl - The originally-requested URL, normalised
 *   (`withoutHashAndAuth` form).
 * @param redirectPaths - The redirect chain hops captured during fetch, in
 *   order (empty when the page was not redirected).
 * @param entries - The console log entries to persist. Must be non-empty —
 *   callers should skip calling this function entirely for an empty list.
 * @example
 * await replaceConsoleLogs(knex, caches, page.url.withoutHashAndAuth, page.redirectPaths, entries);
 */
export async function replaceConsoleLogs(
	knex: Knex,
	caches: WriteRefCaches,
	pageUrl: string,
	redirectPaths: readonly string[],
	entries: readonly ConsoleLogEntry[],
): Promise<void> {
	const { destUrl } = resolveRedirectChain(pageUrl, redirectPaths);

	try {
		await knex.transaction(async (trx) => {
			const pageId = await resolveContentItemId(trx, caches, destUrl);
			await trx('page_console_logs').where('pageId', pageId).delete();

			const texts = new Set<string>();
			for (const entry of entries) {
				// `text_refs` never stores the empty string (its upsert
				// treats `''` as "nothing to dedupe" and skips it) — a
				// `console.log()` call with zero arguments reports `text:
				// ''`, so that entry resolves to `textId: null` below
				// instead of looking it up.
				if (entry.text !== '') {
					texts.add(entry.text);
				}
				if (entry.stack) {
					texts.add(entry.stack);
				}
			}
			const textIds = await upsertTextRefs(trx, texts);

			const rows: { pageId: number; consoleLogId: number; ts: number }[] = [];
			for (const entry of entries) {
				let textId: number | null = null;
				if (entry.text !== '') {
					const resolved = textIds.get(entry.text);
					if (resolved === undefined) {
						throw new Error(
							`replaceConsoleLogs: text_refs id not resolved for "${entry.text}"`,
						);
					}
					textId = resolved;
				}
				const stackTextId = entry.stack ? (textIds.get(entry.stack) ?? null) : null;
				const argsJson = stringifyConsoleLogArgs(entry.args);
				const argsJsonId =
					argsJson === null ? null : await upsertJsonRef(trx, caches, argsJson);
				const locUrlId =
					entry.location?.url === undefined
						? null
						: await upsertUrlRef(trx, caches, entry.location.url);

				const consoleLogId = await upsertConsoleLogItem(trx, caches, {
					hash: computeConsoleLogHash({
						type: entry.type,
						text: entry.text,
						argsJson,
						location: entry.location,
						stack: entry.stack,
					}),
					type: entry.type,
					textId,
					argsJsonId,
					locUrlId,
					locLine: entry.location?.lineNumber ?? null,
					locColumn: entry.location?.columnNumber ?? null,
					stackTextId,
				});
				rows.push({ pageId, consoleLogId, ts: entry.ts });
			}

			for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
				await trx('page_console_logs').insert(
					rows.slice(index, index + INSERT_CHUNK_SIZE),
				);
			}

			// Denormalised onto `page_meta` (the same write-once-at-scrape-time
			// pattern as `tag_count` / `jsonld_count`) so the Pages list can
			// display and sort by it without a live JOIN + COUNT per row.
			// Computed from `entries` directly rather than re-querying the rows
			// just inserted above — the data is already in hand. A `page_meta`
			// row may not exist yet for a `'skipped'` / `'error'` scrape; the
			// UPDATE then simply affects zero rows rather than throwing.
			const errorCount = entries.filter(
				(entry) => entry.type === 'error' || entry.type === 'pageerror',
			).length;
			await trx('page_meta').where('page_id', pageId).update({
				console_error_count: errorCount,
			});
		});
	} catch (error) {
		// A rolled-back transaction can leave ids cached that no longer
		// correspond to any row (AUTOINCREMENT never rewinds) — same
		// cache-poisoning hazard `updatePage` / `recordRedirect` guard
		// against. A full clear (not a partial one) is required because
		// this function shares `caches` with every other write path on
		// the same connection.
		clearWriteRefCaches(caches);
		throw error;
	}
}
