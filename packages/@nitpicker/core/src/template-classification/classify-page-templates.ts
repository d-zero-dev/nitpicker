import type { ProgressEvent } from '@d-zero/page-cluster/resolve-page-cluster-keys';
import type { Archive, Page } from '@nitpicker/crawler';

import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolvePageClusterKeys } from '@d-zero/page-cluster/resolve-page-cluster-keys';
import { Cache } from '@d-zero/shared/cache';

import { collectPageStylesheetUrls } from './collect-page-stylesheet-urls.js';
import { createPageClusterFactory } from './create-page-cluster-factory.js';

/**
 * Options for {@link classifyPageTemplates}.
 */
export interface ClassifyPageTemplatesOptions {
	/** The archive to read pages/stylesheets from and to derive the cache key from. */
	archive: Archive;
	/**
	 * All pages already loaded for this `analyze()` run (see
	 * `Nitpicker.analyze`'s accumulation across `getPagesWithRefs` batches —
	 * classification must run once, globally, not per batch).
	 */
	pages: readonly Page[];
	/**
	 * Progress callback forwarded to `@d-zero/page-cluster`'s
	 * `resolvePageClusterKeys`, so long-running classification on large
	 * archives isn't silently unresponsive.
	 */
	onProgress?: (event: ProgressEvent) => void;
}

/**
 * Classifies every internal HTML page in the archive into a template group
 * by DOM-structure similarity, using `@d-zero/page-cluster`.
 *
 * Result is cached, keyed by the archive file's path + size + mtime + page
 * count (see {@link buildArchiveCacheKey}). **This only helps one narrow
 * case**: a crash or Ctrl-C after this function completes but before
 * `nitpicker.write()` finishes (writing back a multi-gigabyte archive can
 * itself take a while) — re-running on the same, not-yet-rewritten archive
 * file hits the cache instead of re-running the whole multi-pass clustering.
 * It does **not** help a *second, fully successful* `analyze --templates`
 * run on the same crawled data: `nitpicker.write()` always re-packages the
 * archive (new mtime, and usually a different size), which changes the key
 * on every completed run. There is no explicit `--force` escape hatch —
 * any change to the archive changes the key, which is the correctness
 * signal this cache relies on. The cache is **not** cleared at the start of
 * a run (unlike the per-plugin `Cache` in `nitpicker.ts`) — its entire
 * purpose is surviving the one crash-before-write window described above.
 *
 * There is no mid-computation checkpoint/resume: `resolvePageClusterKeys`
 * holds state across its own internal multi-pass read and has no resume
 * API, so a crash *during* classification means the next run classifies
 * from scratch (this is a limitation of the upstream library, not something
 * this function works around).
 *
 * Internally: the external library's `resolvePageClusterKeys` returns a
 * `clusterKey` per page; this function's public naming is `templateKey`,
 * to avoid colliding with nitpicker's unrelated pre-existing "isolated
 * cluster" concept (`@nitpicker/query`'s `compute-isolated-clusters.ts`,
 * link-reachability graph components — a completely different kind of
 * grouping from DOM-structure similarity).
 * @param options - See {@link ClassifyPageTemplatesOptions}.
 * @returns Map from page URL (`page.url.href`) to its template key. Only
 *   internal HTML pages with retrievable HTML have an entry.
 * @example
 * ```ts
 * const templateKeys = await classifyPageTemplates({ archive, pages });
 * for (const [url, templateKey] of templateKeys) {
 *   table.addData({ [url]: { templateKey: { value: templateKey } } });
 * }
 * ```
 */
export async function classifyPageTemplates(
	options: ClassifyPageTemplatesOptions,
): Promise<Map<string, string>> {
	const { archive, pages, onProgress } = options;
	const cache = getTemplateCache();
	const cacheKey = await buildArchiveCacheKey(archive.filePath, pages.length);

	if (cacheKey) {
		const cached = await cache.load(cacheKey);
		if (cached) {
			return new Map(Object.entries(cached));
		}
	}

	const stylesheetsByUrl = await collectPageStylesheetUrls(archive);
	const { factory, getYieldedUrls } = createPageClusterFactory(pages, stylesheetsByUrl);

	const clusterKeys = await resolvePageClusterKeys(
		factory,
		onProgress ? { onProgress } : undefined,
	);
	// Safe only after `resolvePageClusterKeys` has resolved — see
	// `createPageClusterFactory`'s JSDoc for why.
	const yieldedUrls = getYieldedUrls();

	if (clusterKeys.length !== yieldedUrls.length) {
		// Would silently mis-map template keys to the wrong URLs if allowed
		// through — see createPageClusterFactory's JSDoc for why this should
		// be structurally impossible, but a loud failure here is far
		// preferable to a quiet mis-assignment.
		throw new Error(
			`classifyPageTemplates: resolvePageClusterKeys returned ${clusterKeys.length} keys for ${yieldedUrls.length} yielded pages.`,
		);
	}

	const result = new Map<string, string>();
	for (const [index, url] of yieldedUrls.entries()) {
		result.set(url, clusterKeys[index]!);
	}

	if (cacheKey) {
		await cache.store(cacheKey, Object.fromEntries(result));
	}

	return result;
}

/**
 * Lazily constructs the persistent template-classification cache. Kept as a
 * function (rather than a module-level constant) so tests can point it at
 * an isolated tmpDir-per-test without module-mocking `os.tmpdir`.
 */
function getTemplateCache() {
	return new Cache<Record<string, string>>(
		'nitpicker-templates',
		path.join(os.tmpdir(), 'nitpicker/cache/templates'),
	);
}

/**
 * Derives a cache key from the archive file's identity: its absolute path,
 * byte size, mtime, and internal HTML page count. Byte size + mtime alone is
 * a coarse signal — a same-path overwrite that happens to land on the same
 * byte size within the filesystem's mtime tick (coarse mtime resolution,
 * or two writes close enough together) would otherwise be indistinguishable
 * from "unchanged". Page count is folded in as a cheap (already-computed,
 * no extra query), second independent signal that most re-crawls
 * (`--append` / `--inventory`) change; it does **not** catch every
 * possible content change (e.g. `--retry-failed` replacing a failed page's
 * content without changing the total page count), which is an accepted,
 * documented gap rather than an attempt at a full content hash — hashing
 * every page's HTML on every `analyze()` call would cost more than the
 * cache is meant to save.
 * @param archiveFilePath - `Archive.filePath` of the archive being analyzed.
 * @param pageCount - Number of pages passed to {@link classifyPageTemplates}
 *   for this run (`pages.length`, before internal/HTML filtering).
 * @returns The cache key, or `null` if the file's stats cannot be read
 *   (falls back to always recomputing rather than caching under the wrong
 *   key).
 */
async function buildArchiveCacheKey(
	archiveFilePath: string,
	pageCount: number,
): Promise<string | null> {
	try {
		const stats = await stat(archiveFilePath);
		return `${archiveFilePath}:${stats.size}:${stats.mtimeMs}:${pageCount}`;
	} catch {
		return null;
	}
}
