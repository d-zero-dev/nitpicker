import type { PageSource } from '../types.js';
import type { Knex } from 'knex';

/**
 * Optional column overrides for {@link seedContentItem}. Defaults model a
 * scraped, internal, targeted page with no content type.
 */
interface SeedContentItemOptions {
	/** `content_items.scraped` (default 1). */
	scraped?: 0 | 1;
	/** `content_items.is_target` (default 1). */
	isTarget?: 0 | 1;
	/** `content_items.is_external` (default 0). */
	isExternal?: 0 | 1;
	/** `content_items.source` (default: schema default `'crawled'`). */
	source?: PageSource;
	/** Registers the value in `content_type_refs` and links it (default: none). */
	contentType?: string;
}

/**
 * Inserts one `url_refs` + `content_items` pair — the minimal seeding
 * contract for specs that exercise entity-table readers. Shared so a
 * schema change to the pair (e.g. a new NOT NULL column) is fixed in one
 * place instead of drifting across per-spec copies.
 * @param db - Knex connected to the test DB.
 * @param url - URL string to register in `url_refs`.
 * @param options - Column overrides; see {@link SeedContentItemOptions}.
 * @returns The inserted `content_items.id`.
 * @example
 * const pageId = await seedContentItem(db, 'https://example.com/');
 * const pdfId = await seedContentItem(db, 'https://example.com/doc.pdf', {
 *   contentType: 'application/pdf',
 * });
 */
export async function seedContentItem(
	db: Knex,
	url: string,
	options: SeedContentItemOptions = {},
): Promise<number> {
	const [urlRef] = await db('url_refs').insert({ url }).returning('id');
	let contentTypeId: number | null = null;
	if (options.contentType !== undefined) {
		const [ctRef] = await db('content_type_refs')
			.insert({
				raw: options.contentType,
				normalized: options.contentType,
				category: 'other',
			})
			.onConflict('raw')
			.merge({ raw: options.contentType })
			.returning('id');
		contentTypeId = ctRef.id;
	}
	const [item] = await db('content_items')
		.insert({
			url_id: urlRef.id,
			scraped: options.scraped ?? 1,
			is_target: options.isTarget ?? 1,
			is_external: options.isExternal ?? 0,
			content_type_id: contentTypeId,
			...(options.source === undefined ? {} : { source: options.source }),
		})
		.returning('id');
	return item.id;
}
