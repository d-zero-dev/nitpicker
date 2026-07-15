import type { Resource } from '../../../utils/types/types.js';
import type { DB_Resource, PageSource } from '../../types.js';
import type { Knex } from 'knex';

import { normalizeContentType } from '../../../crawler/normalize-content-type.js';

/**
 * Inserts a sub-resource into the `resources` table.
 * Ignores duplicate URLs (uses `ON CONFLICT IGNORE`).
 *
 * The `source` provenance label is written ONLY on insert; an
 * `ON CONFLICT IGNORE` collision leaves an existing row's source untouched
 * (this is what makes a second `crawl --inventory` non-destructive).
 * @param knex - Knex query builder connected to the archive DB.
 * @param resource - The resource data to insert.
 * @param source - Provenance label for new rows. `undefined` leaves the DB DEFAULT (`'crawled'`).
 */
export async function insertResource(
	knex: Knex,
	resource: Resource,
	source?: PageSource,
): Promise<void> {
	await knex
		.from<DB_Resource>('resources')
		.insert({
			url: resource.url.href,
			isExternal: resource.isExternal ? 1 : 0,
			status: resource.status,
			statusText: resource.statusText,
			// Canonicalize like `pages.contentType` (see #insertPage) so resource
			// content-type filters / dedupe keys are case- and whitespace-stable.
			contentType: normalizeContentType(resource.contentType),
			contentLength: resource.contentLength,
			compress: resource.compress || 0,
			cdn: resource.cdn || 0,
			responseHeaders: JSON.stringify(resource.headers),
			...(source === undefined ? {} : { source }),
		})
		.onConflict('url')
		.ignore();
}
