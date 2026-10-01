import type { TransferCallbacks, TransferSourceResult } from './types.js';
import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';
import type { Knex } from 'knex';

import { attachSourceDatabase } from './attach-source-database.js';
import { clearReplacedPageRows } from './clear-replaced-page-rows.js';
import { copyAnalysisViolations } from './copy-analysis-violations.js';
import { copyAnchorEdges } from './copy-anchor-edges.js';
import { copyDictionariesForConcat } from './copy-dictionaries-for-concat.js';
import { copyDictionariesForSplit } from './copy-dictionaries-for-split.js';
import { copyHeaderSetChildren } from './copy-header-set-children.js';
import { copyImageItems } from './copy-image-items.js';
import { copyJournalTables } from './copy-journal-tables.js';
import { copyPageConsoleLogs } from './copy-page-console-logs.js';
import { copyPageHtmlBlobs } from './copy-page-html-blobs.js';
import { copyPageMeta } from './copy-page-meta.js';
import { copyPageTemplateClusters } from './copy-page-template-clusters.js';
import { copyPageTemplateLabels } from './copy-page-template-labels.js';
import { copyResourceItems } from './copy-resource-items.js';
import { copyResourceRefEdges } from './copy-resource-ref-edges.js';
import { copySimplePageScopedTables } from './copy-simple-page-scoped-tables.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { insertContentItems } from './insert-content-items.js';
import { markInScopeContentItems } from './mark-in-scope-content-items.js';
import { planContentItemsForConcat } from './plan-content-items-for-concat.js';
import { planContentItemsForSplit } from './plan-content-items-for-split.js';
import { planResourceItems } from './plan-resource-items.js';
import { remapRedirectDestIds } from './remap-redirect-dest-ids.js';
import { replaceContentItems } from './replace-content-items.js';
import { TRANSFER_ACTION } from './transfer-action.js';
import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

/** One source's transfer mode and (for split) scope-check inputs. */
export type TransferSourceMode =
	| { readonly kind: 'concat' }
	| {
			readonly kind: 'split';
			readonly scopeMap: ReadonlyMap<string, readonly ExURL[]>;
			readonly parseOptions?: ParseURLOptions;
	  };

/**
 * Computes {@link TransferSourceResult} from the finished plan tables.
 * `dropped` (split only) is `sourceTotal - (inserted + stubbed)` — the
 * plan never lists dropped rows explicitly, so this is a subtraction
 * against the source's own total row count rather than a query for
 * absence.
 * @param trx - The open transaction.
 * @param mode - `'split'` computes `dropped`; `'concat'` always reports `0`.
 */
async function summarizeTransferResult(
	trx: Knex,
	mode: 'concat' | 'split',
): Promise<TransferSourceResult> {
	const rows: { action: number; count: number }[] = await trx
		.select('action')
		.count({ count: '*' })
		.from('xfer_ci_plan')
		.groupBy('action');
	const byAction = new Map(rows.map((r) => [r.action, Number(r.count)]));
	const inserted = byAction.get(TRANSFER_ACTION.full) ?? 0;
	const replaced = byAction.get(TRANSFER_ACTION.replace) ?? 0;
	const skipped = byAction.get(TRANSFER_ACTION.skip) ?? 0;
	const stubbed = byAction.get(TRANSFER_ACTION.stub) ?? 0;

	let dropped = 0;
	if (mode === 'split') {
		const [totalRow] = await trx
			.count<{ total: number }[]>({ total: '*' })
			.from(`${TRANSFER_SOURCE_ALIAS}.content_items`);
		dropped = Number(totalRow?.total ?? 0) - (inserted + stubbed);
	}

	return { inserted, replaced, skipped, stubbed, dropped };
}

/**
 * Transfers ONE source archive's rows into the destination — the shared
 * engine {@link import('./concat-archives.js').concatArchives} and
 * {@link import('./split-archive.js').splitArchive} both drive, once per
 * source. Attaches the source, plans, copies every table in dependency
 * order, and detaches — always, even on failure (`finally`).
 *
 * Order within the transaction (see each step's own docs for why this
 * exact order, not a different one):
 * 1. Plan `content_items` (mode-specific) and `resource_items`.
 * 2. Copy every dictionary (mode-specific), then their `header_sets`
 *    children and `page_html_blobs` (both depend on the dictionary maps
 *    dictionaries step just built).
 * 3. Concat only: clear the old page-scoped rows of every `replace`
 *    destination, then overwrite its `content_items` row. Both modes:
 *    insert every `full`/`stub` row, backfilling `dest_id`; remap
 *    `redirect_dest_id` now that every row has one.
 * 4. Copy every page-scoped table.
 * 5. Copy `resource_items` (and its js-scan cache), then
 *    `resource_ref_edges` (needs the resource plan's `dest_id`, just
 *    resolved).
 * 6. Copy the append-only journal tables.
 * @param options - See individual properties.
 * @param options.knex - Knex connected to the destination archive DB (the
 *   connection ATTACH/temp-tables/transaction all operate against).
 * @param options.sourceDbPath - Absolute path to the source's `db.sqlite`
 *   (e.g. `path.join(accessor.tmpDir, Archive.SQLITE_DB_FILE_NAME)`).
 * @param options.mode - `{ kind: 'concat' }`, or `{ kind: 'split',
 *   scopeMap, parseOptions? }` for the narrower-scope pass.
 * @param options.crawlOrderOffset - Forwarded to
 *   `insertContentItems`/`replaceContentItems` — see their docs.
 * @param options.sourceIndex - This source's 0-based position, forwarded
 *   verbatim to `callbacks` — purely for display, not used in any query.
 * @param options.callbacks - Progress callbacks; see `types.ts`.
 * @returns Per-action row counts — see {@link TransferSourceResult}.
 * @example
 * ```ts
 * const result = await transferArchiveRows({
 *   knex: destination.getKnex(),
 *   sourceDbPath: path.join(accessor.tmpDir, Archive.SQLITE_DB_FILE_NAME),
 *   mode: { kind: 'concat' },
 *   crawlOrderOffset: 0,
 *   sourceIndex: 0,
 * });
 * ```
 */
export async function transferArchiveRows(options: {
	readonly knex: Knex;
	readonly sourceDbPath: string;
	readonly mode: TransferSourceMode;
	readonly crawlOrderOffset: number;
	readonly sourceIndex: number;
	readonly callbacks?: TransferCallbacks;
}): Promise<TransferSourceResult> {
	const { knex, sourceDbPath, mode, crawlOrderOffset, sourceIndex, callbacks } = options;
	const detach = await attachSourceDatabase(knex, sourceDbPath);
	await createTransferTempTables(knex);
	try {
		return await knex.transaction(async (trx) => {
			callbacks?.onPhase?.(sourceIndex, 'planningContentItems');
			if (mode.kind === 'split') {
				await markInScopeContentItems(trx, mode.scopeMap, mode.parseOptions);
				await planContentItemsForSplit(trx);
				await planResourceItems(trx, 'split');
			} else {
				await planContentItemsForConcat(trx);
				await planResourceItems(trx, 'concat');
			}

			callbacks?.onPhase?.(sourceIndex, 'copyingDictionaries');
			if (mode.kind === 'split') {
				await copyDictionariesForSplit(trx);
			} else {
				await copyDictionariesForConcat(trx);
			}
			await copyHeaderSetChildren(trx);
			await copyPageHtmlBlobs(trx);

			callbacks?.onPhase?.(sourceIndex, 'copyingContentItems');
			if (mode.kind === 'concat') {
				await clearReplacedPageRows(trx);
				await replaceContentItems(trx, { crawlOrderOffset });
			}
			await insertContentItems(trx, { crawlOrderOffset });
			await remapRedirectDestIds(trx);

			callbacks?.onPhase?.(sourceIndex, 'copyingPageRows');
			await copyPageMeta(trx);
			await copyImageItems(trx);
			await copyAnchorEdges(trx);
			await copySimplePageScopedTables(trx);
			await copyPageTemplateClusters(trx);
			await copyPageTemplateLabels(trx);
			await copyPageConsoleLogs(trx);
			await copyAnalysisViolations(trx);

			callbacks?.onPhase?.(sourceIndex, 'copyingResources');
			await copyResourceItems(trx);
			await copyResourceRefEdges(trx);

			callbacks?.onPhase?.(sourceIndex, 'copyingJournals');
			await copyJournalTables(trx, mode.kind);

			callbacks?.onPhase?.(sourceIndex, 'committing');
			return await summarizeTransferResult(trx, mode.kind);
		});
	} finally {
		await dropTransferTempTables(knex);
		await detach();
	}
}
