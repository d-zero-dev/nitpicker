import type { TagRowForInsert } from './types.js';
import type { TagsMeta } from '@d-zero/beholder';

/**
 * Flattens {@link TagsMeta.entries} (per provider × external-id tuple) into
 * insert-ready rows for the `page_tags` table.
 *
 * One Wappalyzer entry → one row. `entry.id` becomes `externalId`. `category`
 * is the first element of `categories`; the full list is preserved in the
 * `categories` JSON column. `sources` is preserved verbatim as a JSON column.
 *
 * `pageId` is **not** filled here — the database layer injects it because the
 * page row is `INSERT`-ed in the same transaction and its ID is known only at
 * insert time.
 * @param tags - The `meta.tags` object from beholder.
 * @returns Rows ready for the `page_tags` insert; empty array when no tags
 *   were detected.
 */
export function extractTagsForArchive(
	tags: TagsMeta | undefined,
): ReadonlyArray<Omit<TagRowForInsert, 'pageId'>> {
	// `tags` can be undefined when fed legacy minimal-Meta test fixtures.
	// Real beholder 3.0.0 always populates this required field.
	const entries = tags?.entries ?? [];
	if (entries.length === 0) return [];
	return entries.map((entry) => ({
		provider: entry.provider,
		category: entry.categories[0] ?? null,
		externalId: entry.id ?? null,
		version: entry.version ?? null,
		confidence: entry.confidence ?? null,
		categories: [...entry.categories],
		sources: entry.sources.map((s) => ({
			type: s.type,
			src: s.src,
			location: s.location,
			globalName: s.globalName,
		})),
	}));
}
