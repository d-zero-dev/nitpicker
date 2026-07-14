import type { Knex } from 'knex';

import { DATA_URI_URL_REFS_LIMIT } from '../populate-ref-tables/data-uri-url-refs-limit.js';

import { resolveJsonRefs } from './resolve-json-refs.js';
import { resolveTextRefs } from './resolve-text-refs.js';
import { resolveUrlRefs } from './resolve-url-refs.js';

/**
 * Rows scanned per keyset-paginated `SELECT` chunk against
 * `pages WHERE scraped = 1`. The row width here is dominated by long
 * text columns (`meta_extras` JSON, `description`, `twitter_description`)
 * so 400 rows caps peak chunk memory at ≈ 40 MB on the reference
 * archive.
 */
const READ_CHUNK_SIZE = 400;

/**
 * Rows sent per `INSERT INTO page_meta ... VALUES (...)` statement. Each
 * row binds 47 params (see the column list below), so 200 rows =
 * 9 400 params — safely under SQLite's default variable limit.
 */
const INSERT_CHUNK_SIZE = 200;

/**
 * Text-shaped columns on `pages` mapped 1:1 to `<name>_text_id` FKs on
 * `page_meta`. `robots_raw` is grouped here despite the different suffix
 * — it maps to `robots_raw_text_id`, still a `text_refs` FK.
 */
const TEXT_COLUMN_MAP: readonly { source: string; target: string }[] = [
	{ source: 'title', target: 'title_text_id' },
	{ source: 'description', target: 'description_text_id' },
	{ source: 'keywords', target: 'keywords_text_id' },
	{ source: 'robots_raw', target: 'robots_raw_text_id' },
	{ source: 'og_title', target: 'og_title_text_id' },
	{ source: 'og_description', target: 'og_description_text_id' },
	{ source: 'twitter_title', target: 'twitter_title_text_id' },
	{ source: 'twitter_description', target: 'twitter_description_text_id' },
];

/**
 * URL-shaped columns on `pages` mapped 1:1 to `<name>_url_id` FKs on
 * `page_meta`.
 */
const URL_COLUMN_MAP: readonly { source: string; target: string }[] = [
	{ source: 'canonical', target: 'canonical_url_id' },
	{ source: 'amphtml', target: 'amphtml_url_id' },
	{ source: 'manifest', target: 'manifest_url_id' },
	{ source: 'icon_href', target: 'icon_url_id' },
	{ source: 'appleTouchIcon_href', target: 'apple_touch_icon_url_id' },
	{ source: 'og_url', target: 'og_url_id' },
	{ source: 'og_image', target: 'og_image_url_id' },
	{ source: 'twitter_image', target: 'twitter_image_url_id' },
];

/**
 * Populates `page_meta` from `pages WHERE scraped = 1` (issue #193 step entity populate step 2).
 *
 * Pages that were never scraped contribute no meta rows — they have no rendered title,
 * description, or JSON-LD to preserve, so filtering at the SELECT keeps
 * the reader working set narrow and matches the 0.13 check
 * `count(*) FROM page_meta = count(*) FROM pages WHERE scraped = 1`.
 *
 * Per chunk:
 *
 * 1. **Keyset-paginate** `pages.id > cursor AND scraped = 1`.
 * 2. **Batch-resolve** all text / URL / JSON ref ids for every value in
 *    the chunk — three resolvers, one round-trip per ref table.
 * 3. **Bulk INSERT** with `page_id = pages.id`. `page_id` is both PK and
 *    FK on `content_items(id)`; 0.13-1 must have already inserted
 *    the corresponding `content_items` row for the FK to be valid at
 *    COMMIT time.
 *
 * `INSERT OR IGNORE` on the `page_id` PK makes the step idempotent so
 * partial-failure re-runs are safe.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateContentItems(trx);
 *   await populatePageMeta(trx);
 * });
 */
export async function populatePageMeta(trx: Knex): Promise<void> {
	const textColumns = TEXT_COLUMN_MAP.map((entry) => entry.source);
	const urlColumns = URL_COLUMN_MAP.map((entry) => entry.source);
	const plainColumns = [
		'id',
		'lang',
		'dir',
		'charset',
		'baseHref',
		'viewport_raw',
		'themeColor',
		'applicationName',
		'author',
		'generator',
		'publisher',
		'robots_noindex',
		'robots_nofollow',
		'robots_noarchive',
		'robots_noimageindex',
		'googlebot',
		'og_type',
		'og_site_name',
		'og_image_alt',
		'og_image_width',
		'og_image_height',
		'og_locale',
		'og_article_published_time',
		'og_article_modified_time',
		'twitter_card',
		'twitter_site',
		'twitter_creator',
		'fb_app_id',
		'verification_google',
		'formatDetection_telephone',
		'tag_count',
		'jsonld_count',
		'tags_providers_csv',
		'meta_extras',
	];

	let cursor = 0;
	while (true) {
		const rows: Record<string, unknown>[] = await trx('pages')
			.select(...plainColumns, ...textColumns, ...urlColumns)
			.where('id', '>', cursor)
			.andWhere('scraped', true)
			.orderBy('id', 'asc')
			.limit(READ_CHUNK_SIZE);
		if (rows.length === 0) {
			break;
		}
		cursor = rows.at(-1)!.id as number;

		const texts = new Set<string>();
		const urls = new Set<string>();
		const jsonStrings = new Set<string>();
		for (const row of rows) {
			for (const column of textColumns) {
				const value = row[column];
				if (typeof value === 'string' && value !== '') {
					texts.add(value);
				}
			}
			for (const column of urlColumns) {
				const value = row[column];
				if (typeof value === 'string' && value !== '' && !isLargeDataUri(value)) {
					urls.add(value);
				}
			}
			const metaExtras = row.meta_extras;
			if (typeof metaExtras === 'string' && metaExtras !== '') {
				jsonStrings.add(metaExtras);
			}
		}
		const textIds = await resolveTextRefs(trx, texts);
		const urlIds = await resolveUrlRefs(trx, urls);
		const jsonIds = await resolveJsonRefs(trx, jsonStrings);

		const inserts = rows.map((row) => {
			const rowId = row.id as number;
			const insert: Record<string, unknown> = {
				page_id: rowId,
				lang: row.lang ?? null,
				dir: row.dir ?? null,
				charset: row.charset ?? null,
				base_href: row.baseHref ?? null,
				viewport_raw: row.viewport_raw ?? null,
				theme_color: row.themeColor ?? null,
				application_name: row.applicationName ?? null,
				author: row.author ?? null,
				generator: row.generator ?? null,
				publisher: row.publisher ?? null,
				robots_noindex: row.robots_noindex ?? null,
				robots_nofollow: row.robots_nofollow ?? null,
				robots_noarchive: row.robots_noarchive ?? null,
				robots_noimageindex: row.robots_noimageindex ?? null,
				googlebot: row.googlebot ?? null,
				og_type: row.og_type ?? null,
				og_site_name: row.og_site_name ?? null,
				og_image_alt: row.og_image_alt ?? null,
				og_image_width: row.og_image_width ?? null,
				og_image_height: row.og_image_height ?? null,
				og_locale: row.og_locale ?? null,
				og_article_published_time: row.og_article_published_time ?? null,
				og_article_modified_time: row.og_article_modified_time ?? null,
				twitter_card: row.twitter_card ?? null,
				twitter_site: row.twitter_site ?? null,
				twitter_creator: row.twitter_creator ?? null,
				fb_app_id: row.fb_app_id ?? null,
				verification_google: row.verification_google ?? null,
				format_detection_telephone: row.formatDetection_telephone ?? null,
				tag_count: row.tag_count ?? null,
				jsonld_count: row.jsonld_count ?? null,
				tags_providers_csv: row.tags_providers_csv ?? null,
				meta_extras_json_id: resolveOptionalJsonId(row.meta_extras, jsonIds, rowId),
			};
			for (const { source, target } of TEXT_COLUMN_MAP) {
				insert[target] = resolveOptionalTextId(row[source], textIds, rowId, source);
			}
			for (const { source, target } of URL_COLUMN_MAP) {
				insert[target] = resolveOptionalUrlId(row[source], urlIds, rowId, source);
			}
			return insert;
		});

		for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
			const chunk = inserts.slice(index, index + INSERT_CHUNK_SIZE);
			await trx('page_meta').insert(chunk).onConflict('page_id').ignore();
		}
	}
}

/**
 * Returns `true` when `value` is a `data:` URI larger than the routing
 * threshold — i.e. one that 0.13-1 sent to `blob_refs` instead of
 * `url_refs`. `page_meta` has no `*_blob_id` companion columns for its
 * URL slots (see plan §page_meta schema), so we skip these values from
 * the `url_refs` lookup rather than issue a doomed `WHERE url IN (?)`
 * that would burn a chunk slot per multi-KB URI. The resulting
 * `*_url_id` is null with a `console.warn` breadcrumb; the operator
 * can then decide whether the archive needs a schema extension or the
 * raw data warrants normalisation.
 * @param value - Raw URL column value.
 */
function isLargeDataUri(value: string): boolean {
	return value.startsWith('data:') && value.length > DATA_URI_URL_REFS_LIMIT;
}

/**
 * Resolves `text_refs.id` for a `page_meta.<name>_text_id` slot or
 * throws when a non-empty source value has no matching `text_refs` row
 * (parity with `populateContentItems`' `url_id` throw — silent NULL
 * corruption would still let the count-based acceptance invariant pass
 * while individual `page_meta` rows lose their meta text).
 * @param value - Raw column value from the source `pages` row.
 * @param textIds - Map from 0.13-2's populate step.
 * @param pageId - Owning page id (for the error message).
 * @param column - Source column name (for the error message).
 */
function resolveOptionalTextId(
	value: unknown,
	textIds: ReadonlyMap<string, number>,
	pageId: number,
	column: string,
): number | null {
	if (typeof value !== 'string' || value === '') {
		return null;
	}
	const id = textIds.get(value);
	if (id === undefined) {
		throw new Error(
			`populatePageMeta: text_refs.id not resolved for page id=${pageId} column=${column} — 0.13-2 populate must run first`,
		);
	}
	return id;
}

/**
 * Resolves `url_refs.id` for a `page_meta.<name>_url_id` slot, throws
 * on a missing lookup for a regular URL, and returns `null` (with a
 * warning) for large data URIs that 0.13-1 routed to `blob_refs`
 * — those cannot land in `page_meta` because the schema has no
 * `*_blob_id` companion columns.
 * @param value - Raw column value from the source `pages` row.
 * @param urlIds - Map from 0.13-1's populate step.
 * @param pageId - Owning page id (for the error message).
 * @param column - Source column name (for the error message).
 */
function resolveOptionalUrlId(
	value: unknown,
	urlIds: ReadonlyMap<string, number>,
	pageId: number,
	column: string,
): number | null {
	if (typeof value !== 'string' || value === '') {
		return null;
	}
	if (isLargeDataUri(value)) {
		// eslint-disable-next-line no-console
		console.warn(
			`populatePageMeta: dropping large data URI in page id=${pageId} column=${column} (page_meta has no *_blob_id companion for URL columns)`,
		);
		return null;
	}
	const id = urlIds.get(value);
	if (id === undefined) {
		throw new Error(
			`populatePageMeta: url_refs.id not resolved for page id=${pageId} column=${column} — 0.13-1 populate must run first`,
		);
	}
	return id;
}

/**
 * Resolves `json_refs.id` for `page_meta.meta_extras_json_id` or throws
 * when the source `meta_extras` string has no matching `json_refs` row
 * (parity with the text/url branches above).
 * @param value - Raw `meta_extras` value from the source `pages` row.
 * @param jsonIds - Map from 0.13-3's populate step.
 * @param pageId - Owning page id (for the error message).
 */
function resolveOptionalJsonId(
	value: unknown,
	jsonIds: ReadonlyMap<string, number>,
	pageId: number,
): number | null {
	if (typeof value !== 'string' || value === '') {
		return null;
	}
	const id = jsonIds.get(value);
	if (id === undefined) {
		throw new Error(
			`populatePageMeta: json_refs.id not resolved for page id=${pageId} column=meta_extras — 0.13-3 populate must run first`,
		);
	}
	return id;
}
