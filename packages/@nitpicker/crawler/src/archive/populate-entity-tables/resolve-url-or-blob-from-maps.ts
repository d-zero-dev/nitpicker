import { isBlobRefValue } from './is-blob-ref-value.js';

/**
 * Routes one legacy URL-shaped value to either `url_refs` or `blob_refs`
 * per the {@link isBlobRefValue} threshold rule, looking the id up in
 * pre-resolved maps rather than upserting (the populate steps batch-resolve
 * every distinct value across a whole chunk before this per-row lookup —
 * see `resolveUrlRefs` / `resolveBlobRefs`). At most one of `url` / `blob`
 * is non-null; both may be `null` when the value is null or fails to
 * resolve (e.g. the `blob_refs` row is missing because the data URI was
 * malformed and skipped by `populateBlobRefs`).
 * @param value - Raw URL-shaped column value.
 * @param urlIds - Map of URL string → `url_refs.id`.
 * @param blobIds - Map of data-URI string → `blob_refs.id`.
 * @returns `{ url, blob }` pair with at most one non-null field.
 * @example
 * const slot = resolveUrlOrBlobFromMaps(row.src, urlIds, blobIds);
 * // slot.url set for a regular URL, slot.blob set for a large data: URI.
 */
export function resolveUrlOrBlobFromMaps(
	value: string | null,
	urlIds: ReadonlyMap<string, number>,
	blobIds: ReadonlyMap<string, number>,
): { url: number | null; blob: number | null } {
	if (typeof value !== 'string' || value === '') {
		return { url: null, blob: null };
	}
	if (isBlobRefValue(value)) {
		return { url: null, blob: blobIds.get(value) ?? null };
	}
	return { url: urlIds.get(value) ?? null, blob: null };
}
