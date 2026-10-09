import type { ArchiveAccessor } from '../archive-accessor.js';
import type Archive from '../archive.js';
import type { ConcatArchivesResult, TransferCallbacks } from './types.js';

import path from 'node:path';

import ArchiveDefault from '../archive.js';
import { buildScopeMap } from '../scope/build-scope-map.js';

import { copyInventorySourceLists } from './copy-inventory-source-lists.js';
import { countExternalPagesInScope } from './count-external-pages-in-scope.js';
import { flattenRedirectChains } from './flatten-redirect-chains.js';
import { mergeArchiveConfigs } from './merge-archive-configs.js';
import { reclassifyResourceExternality } from './reclassify-resource-externality.js';
import { transferArchiveRows } from './transfer-archive-rows.js';

/**
 * Merges two or more read-only-opened source archives into an already
 * `Archive.create`d, empty destination — the crawler-side half of the
 * `concat` CLI command. Does not open/close/write anything itself: the
 * caller owns every accessor's and the destination's lifecycle (see
 * `docs/concat.md` and the CLI's `commands/concat.ts`, which owns the
 * full open → transfer → rebuild-read-model → write sequence this is one
 * step of).
 *
 * Sources are transferred ONE AT A TIME, in argument order, each one's
 * `crawlOrderOffset` set to the destination's current
 * `MAX(content_items.crawl_order)` so a later source's pages always sort
 * after an earlier one's — this is what makes "ties go to the later
 * argument" (see `plan-content-items-for-concat.ts`) match the pages'
 * OWN display order too, not just their win/lose outcome.
 *
 * After every source is transferred: `flattenRedirectChains` (a merge can
 * reintroduce a two-hop redirect chain no single source ever has),
 * `reclassifyResourceExternality` against the MERGED scope, and
 * `countExternalPagesInScope` for the CLI's `--append` hint (concat never
 * promotes such pages itself — see `types.ts`'s
 * `ConcatArchivesResult.externalInScopeCount` docs).
 * @param options - See individual properties.
 * @param options.sources - Every source, read-only opened
 *   (`Archive.openCached`), in argument order.
 * @param options.destination - The empty destination, already
 *   `Archive.create`d by the caller.
 * @param options.name - The output archive's `name` config field
 *   (typically its basename without extension).
 * @param options.callbacks - Progress callbacks; see `types.ts`.
 * @returns The merged config, each source's transfer outcome, and the
 *   two summary counts.
 * @throws {import('./types.js').ArchiveConfigConflictError} If sources
 *   disagree on `disableQueries`/`fromList` — see `mergeArchiveConfigs`.
 * @example
 * ```ts
 * const destination = await Archive.create({ filePath: outputPath, cwd });
 * const sources = await Promise.all(
 *   inputPaths.map(async (p) => ({ path: p, accessor: await Archive.openCached(p) })),
 * );
 * const result = await concatArchives({ sources, destination, name: 'merged' });
 * ```
 */
export async function concatArchives(options: {
	readonly sources: readonly {
		readonly accessor: ArchiveAccessor;
		readonly path: string;
	}[];
	readonly destination: Archive;
	readonly name: string;
	readonly callbacks?: TransferCallbacks;
}): Promise<ConcatArchivesResult> {
	const { sources, destination, name, callbacks } = options;
	if (sources.length < 2) {
		throw new Error('concatArchives: at least two sources are required');
	}

	const configs = await Promise.all(sources.map((s) => s.accessor.getConfig()));
	const merged = mergeArchiveConfigs(configs, name);
	await destination.setConfig(merged);

	const knex = destination.getKnex();
	const scope = buildScopeMap(merged.roots, merged);

	const results = [];
	for (const [index, source] of sources.entries()) {
		callbacks?.onSourceStart?.(index, source.path);
		const sourceDbPath = path.join(
			source.accessor.tmpDir,
			ArchiveDefault.SQLITE_DB_FILE_NAME,
		);
		const maxRows = await knex('content_items').max<{ max: number | null }[]>({
			max: 'crawl_order',
		});
		const crawlOrderOffset = maxRows[0]?.max ?? 0;
		const result = await transferArchiveRows({
			knex,
			sourceDbPath,
			mode: { kind: 'concat' },
			crawlOrderOffset,
			sourceIndex: index,
			callbacks,
		});
		results.push(result);
	}

	const postIndex = sources.length;
	callbacks?.onPhase?.(postIndex, 'flatteningRedirects');
	await flattenRedirectChains(knex);
	callbacks?.onPhase?.(postIndex, 'reclassifyingResources');
	await reclassifyResourceExternality(knex, scope, merged);
	callbacks?.onPhase?.(postIndex, 'countingExternalInScope');
	const externalInScopeCount = await countExternalPagesInScope(knex, scope, merged);

	const inventoryListsCopied = await copyInventorySourceLists(
		destination,
		sources.map((s) => s.accessor.tmpDir),
	);

	return {
		config: merged,
		sources: results,
		externalInScopeCount,
		inventoryListsCopied,
	};
}
