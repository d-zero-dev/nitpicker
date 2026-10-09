import type { ArchiveAccessor } from '../archive-accessor.js';
import type Archive from '../archive.js';
import type { SplitArchiveResult, TransferCallbacks } from './types.js';

import path from 'node:path';

import ArchiveDefault from '../archive.js';
import { buildScopeMap } from '../scope/build-scope-map.js';

import { buildSplitConfig } from './build-split-config.js';
import { copyInventorySourceLists } from './copy-inventory-source-lists.js';
import { countExternalPagesInScope } from './count-external-pages-in-scope.js';
import { flattenRedirectChains } from './flatten-redirect-chains.js';
import { reclassifyResourceExternality } from './reclassify-resource-externality.js';
import { transferArchiveRows } from './transfer-archive-rows.js';

/**
 * Extracts the subset of one read-only-opened source archive within the
 * given scope URLs into an already `Archive.create`d, empty destination —
 * the crawler-side half of the `split` CLI command. Does not open/close/
 * write anything itself; see `concat-archives.ts`'s docs for the same
 * lifecycle-ownership split (the CLI's `commands/split.ts` owns open →
 * transfer → rebuild-read-model → write).
 *
 * Rejects a `fromList` source up front — see `build-split-config.ts`'s
 * docs for why "roots = the given scope" has no coherent meaning for an
 * archive whose `roots` is a URL list rather than a scope.
 *
 * `flattenRedirectChains` still runs even though a single, not-yet-merged
 * source is already flat by construction — a cheap no-op, kept for the
 * same reason `reclassifyResourceExternality` is written mode-agnostic
 * rather than split having its own near-duplicate of each.
 * @param options - See individual properties.
 * @param options.source - The source, read-only opened
 *   (`Archive.openCached`).
 * @param options.source.path
 * @param options.source.accessor
 * @param options.scopeUrls - The scope URLs the operator gave (raw
 *   strings; normalised to `withoutHash` form by
 *   {@link import('./build-split-config.js').buildSplitConfig}).
 * @param options.destination - The empty destination, already
 *   `Archive.create`d by the caller.
 * @param options.name - The output archive's `name` config field.
 * @param options.callbacks - Progress callbacks; see `types.ts`.
 * @returns The derived config and the transfer outcome.
 * @throws {Error} If the source is a `fromList` archive, or `scopeUrls` is empty.
 * @example
 * ```ts
 * const destination = await Archive.create({ filePath: outputPath, cwd });
 * const accessor = await Archive.openCached(archivePath);
 * const result = await splitArchive({
 *   source: { path: archivePath, accessor },
 *   scopeUrls: ['https://example.com/blog/'],
 *   destination,
 *   name: 'blog',
 * });
 * ```
 */
export async function splitArchive(options: {
	readonly source: { readonly accessor: ArchiveAccessor; readonly path: string };
	readonly scopeUrls: readonly string[];
	readonly destination: Archive;
	readonly name: string;
	readonly callbacks?: TransferCallbacks;
}): Promise<SplitArchiveResult> {
	const { source, scopeUrls, destination, name, callbacks } = options;
	const sourceConfig = await source.accessor.getConfig();
	if (sourceConfig.fromList) {
		throw new Error(
			'split: cannot split a --list/--list-file archive — its roots are a URL list, ' +
				'not a scope, so "roots = the given scope" has no coherent meaning for it.',
		);
	}

	const config = buildSplitConfig(sourceConfig, scopeUrls, name);
	await destination.setConfig(config);

	const knex = destination.getKnex();
	const scope = buildScopeMap(config.roots, config);

	callbacks?.onSourceStart?.(0, source.path);
	const sourceDbPath = path.join(
		source.accessor.tmpDir,
		ArchiveDefault.SQLITE_DB_FILE_NAME,
	);
	const result = await transferArchiveRows({
		knex,
		sourceDbPath,
		mode: { kind: 'split', scopeMap: scope, parseOptions: config },
		crawlOrderOffset: 0,
		sourceIndex: 0,
		callbacks,
	});

	if (result.inserted === 0) {
		throw new Error(
			'split: no page inside the given scope was found in the source archive — nothing to extract.',
		);
	}

	callbacks?.onPhase?.(1, 'flatteningRedirects');
	await flattenRedirectChains(knex);
	callbacks?.onPhase?.(1, 'reclassifyingResources');
	await reclassifyResourceExternality(knex, scope, config);
	callbacks?.onPhase?.(1, 'countingExternalInScope');
	// Not always 0: the operator's scope URLs are not required to be a
	// SUBSET of the source's original roots. A split scope broader than (or
	// merely different from) the original roots can bring a page that was
	// only ever recorded as an external link (never crawled under the
	// source's narrower original scope) inside the new scope — the same
	// "still external, never fabricate a scrape" rule concat's own
	// `externalInScopeCount` documents.
	const externalInScopeCount = await countExternalPagesInScope(knex, scope, config);

	const inventoryListsCopied = await copyInventorySourceLists(destination, [
		source.accessor.tmpDir,
	]);

	return {
		config,
		source: result,
		externalInScopeCount,
		inventoryListsCopied,
	};
}
