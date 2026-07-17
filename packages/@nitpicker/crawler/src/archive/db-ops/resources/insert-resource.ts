import type { Resource } from '../../../utils/types/types.js';
import type { PageSource } from '../../types.js';
import type { WriteRefCaches } from '../_shared/types.js';
import type { Knex } from 'knex';

import { normalizeContentType } from '../../../crawler/normalize-content-type.js';
import { resolveUrlOrBlob } from '../_shared/resolve-url-or-blob.js';
import { upsertContentTypeRef } from '../_shared/upsert-content-type-ref.js';
import { upsertResponseHeaders } from '../_shared/upsert-response-headers.js';

/**
 * Inserts a sub-resource into the `resource_items` table, interning its
 * URL / content type / response headers into the ref tables first. A
 * resource's identity URL routes through {@link resolveUrlOrBlob} like an
 * image `src` — a large inline `data:` URI (e.g. a CSS
 * `background-image` sub-resource) lands in `blob_refs` instead of
 * `url_refs`.
 *
 * A conflict on the identity column (`url_id` or `url_blob_id`) is an
 * **upgrade-only merge**, not first-write-wins: the existing row's
 * response fields (`status` / `status_text` / `content_type_id` /
 * `content_length` / `header_set_id` / `compress` / `cdn`) are replaced
 * only when the existing row currently has `status IS NULL` (beholder's
 * signal for "the request never got a response" — see the `Resource`
 * type) AND the new observation has a non-null `status`. A resource that
 * failed on first sight and later succeeds (the exact case
 * `--retry-failed` re-renders a page for) is therefore healed instead of
 * staying frozen at its failure; a resource that already has a real
 * response never gets overwritten by a later transient failure, and two
 * failures in a row are a no-op — neither carries new information.
 *
 * The `source` provenance label is written ONLY on insert; a conflict
 * (upgrade or no-op alike) leaves an existing row's source untouched
 * (this is what makes a second `crawl --inventory` non-destructive).
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param resource - The resource data to insert.
 * @param source - Provenance label for new rows. `undefined` leaves the DB DEFAULT (`'crawled'`).
 */
export async function insertResource(
	knex: Knex,
	caches: WriteRefCaches,
	resource: Resource,
	source?: PageSource,
): Promise<void> {
	const slot = await resolveUrlOrBlob(knex, caches, resource.url.href);
	// Canonicalize like the page path (see `insertPage`) so resource
	// content-type filters / dedupe keys are case- and whitespace-stable.
	const contentType = normalizeContentType(resource.contentType);
	const contentTypeId =
		contentType == null || contentType === ''
			? null
			: await upsertContentTypeRef(knex, caches, contentType);
	const headerSetId = await upsertResponseHeaders(knex, caches, resource.headers);
	const identityColumn = slot.blob === null ? 'url_id' : 'url_blob_id';
	const identityValue = slot.blob === null ? slot.url : slot.blob;

	const responseFields = {
		is_external: resource.isExternal ? 1 : 0,
		status: resource.status,
		status_text: resource.statusText,
		content_type_id: contentTypeId,
		content_length: resource.contentLength,
		header_set_id: headerSetId,
		compress: resource.compress || 0,
		cdn: resource.cdn || 0,
	};

	const existing = await knex('resource_items')
		.select('id', 'status')
		.where(identityColumn, identityValue)
		.first();

	if (existing === undefined) {
		await knex('resource_items').insert({
			url_id: slot.url,
			url_blob_id: slot.blob,
			...responseFields,
			...(source === undefined ? {} : { source }),
		});
		return;
	}

	if (existing.status === null && resource.status !== null) {
		await knex('resource_items')
			.where('id', existing.id as number)
			.update(responseFields);
	}
}
