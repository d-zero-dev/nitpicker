import type {
	ClassifyPageTemplatesOptions,
	PageTemplateClassification,
} from './types.js';
import type { TemplateClusterReason } from '@nitpicker/crawler';

import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolvePageClusterKeys } from '@d-zero/page-cluster/resolve-page-cluster-keys';
import { Cache } from '@d-zero/shared/cache';

import { collectPageStylesheetUrls } from './collect-page-stylesheet-urls.js';
import { createPageClusterFactory } from './create-page-cluster-factory.js';

/**
 * The persisted shape of one `getTemplateCache()` entry. A named interface
 * (rather than inlining `Record<string, string>` as the cache's value type,
 * which is what this cache stored before cluster reasons existed) so
 * {@link isTemplateClassificationCacheEntry} has a shape to check a loaded
 * value against.
 */
interface TemplateClassificationCacheEntry {
	readonly templateKeys: Record<string, string>;
	readonly clusterReasons: Record<string, TemplateClusterReason>;
}

/**
 * Narrows a loaded cache value to the current {@link TemplateClassificationCacheEntry}
 * shape, so a pre-existing on-disk cache entry from before cluster-reason
 * capture was added (a bare `Record<string, string>`, no `templateKeys` key)
 * is treated as a miss instead of being misread as `{ templateKeys: undefined,
 * clusterReasons: undefined }`. No version counter is used for this — the
 * structural check is sufficient and avoids a magic number that would need
 * bumping on every future cache-shape change.
 * @param value - The value loaded from the persistent cache.
 */
function isTemplateClassificationCacheEntry(
	value: unknown,
): value is TemplateClassificationCacheEntry {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.templateKeys === 'object' &&
		candidate.templateKeys !== null &&
		typeof candidate.clusterReasons === 'object' &&
		candidate.clusterReasons !== null
	);
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
 *
 * `onClusterReason` is always passed to `resolvePageClusterKeys` (not made
 * conditional the way `onProgress` is) — as of `@d-zero/page-cluster` 0.5.3,
 * requesting cluster reasons no longer forces small corpora off the
 * progress-emitting path (see that option's own JSDoc), so there is no
 * responsiveness cost to always capturing them.
 * @param options - See {@link ClassifyPageTemplatesOptions}.
 * @returns See {@link PageTemplateClassification}.
 * @example
 * ```ts
 * const { templateKeysByUrl } = await classifyPageTemplates({ archive, pages });
 * for (const [url, templateKey] of templateKeysByUrl) {
 *   table.addData({ [url]: { templateKey: { value: templateKey } } });
 * }
 * ```
 */
export async function classifyPageTemplates(
	options: ClassifyPageTemplatesOptions,
): Promise<PageTemplateClassification> {
	const { archive, pages, onProgress } = options;
	const cache = getTemplateCache();
	const cacheKey = await buildArchiveCacheKey(archive.filePath, pages.length);

	if (cacheKey) {
		const cached = await cache.load(cacheKey);
		if (cached && isTemplateClassificationCacheEntry(cached)) {
			return {
				templateKeysByUrl: new Map(Object.entries(cached.templateKeys)),
				clusterReasonsByTemplateKey: new Map(Object.entries(cached.clusterReasons)),
			};
		}
	}

	const stylesheetsByUrl = await collectPageStylesheetUrls(archive);
	const { factory, getYieldedUrls } = createPageClusterFactory(pages, stylesheetsByUrl);

	const clusterReasonsByTemplateKey = new Map<string, TemplateClusterReason>();
	const clusterKeys = await resolvePageClusterKeys(factory, {
		...(onProgress ? { onProgress } : {}),
		onClusterReason: (clusterKey, reason) => {
			clusterReasonsByTemplateKey.set(clusterKey, reason);
		},
	});
	// Safe only after `resolvePageClusterKeys` has resolved — see
	// `createPageClusterFactory`'s JSDoc for why.
	const yieldedUrls = getYieldedUrls();

	if (clusterKeys.length !== yieldedUrls.length) {
		// Would silently mis-map template keys to the wrong URLs if allowed
		// through — see createPageClusterFactory's JSDoc for why this should
		// be structurally impossible, but a loud failure here is far
		// preferable to a quiet mis-assignment. No equivalent check exists for
		// `clusterReasonsByTemplateKey` — see `PageTemplateClassification`'s
		// own JSDoc for why that map is a best-effort side channel, not a
		// per-page guarantee.
		throw new Error(
			`classifyPageTemplates: resolvePageClusterKeys returned ${clusterKeys.length} keys for ${yieldedUrls.length} yielded pages.`,
		);
	}

	const templateKeysByUrl = new Map<string, string>();
	for (const [index, url] of yieldedUrls.entries()) {
		templateKeysByUrl.set(url, clusterKeys[index]!);
	}

	if (cacheKey) {
		await cache.store(cacheKey, {
			templateKeys: Object.fromEntries(templateKeysByUrl),
			clusterReasons: Object.fromEntries(clusterReasonsByTemplateKey),
		} satisfies TemplateClassificationCacheEntry);
	}

	return { templateKeysByUrl, clusterReasonsByTemplateKey };
}

/**
 * Lazily constructs the persistent template-classification cache. Kept as a
 * function (rather than a module-level constant) so tests can point it at
 * an isolated tmpDir-per-test without module-mocking `os.tmpdir`.
 */
function getTemplateCache() {
	return new Cache<TemplateClassificationCacheEntry>(
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
