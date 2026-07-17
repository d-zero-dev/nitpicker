import { DATA_URI_URL_REFS_LIMIT } from '../populate-ref-tables/data-uri-url-refs-limit.js';

/**
 * Predicate matching the ref-tables populate's routing rule
 * (`populate-ref-tables/populate-url-refs.ts` /
 * `populate-ref-tables/populate-blob-refs.ts`): a `data:` URI whose
 * length exceeds {@link DATA_URI_URL_REFS_LIMIT} lands in `blob_refs`;
 * anything else (regular URL or short data URI) lands in `url_refs`.
 * Shared by every entity populate that partitions a URL-shaped column
 * into the two dictionaries (`populate-image-items.ts`,
 * `populate-resource-items.ts`).
 * @param value - Raw URL-shaped column value.
 * @returns `true` when the value belongs in `blob_refs`.
 * @example
 * isBlobRefValue('data:image/png;base64,' + 'x'.repeat(600)); // true
 * isBlobRefValue('https://example.com/a.png'); // false
 */
export function isBlobRefValue(value: string): boolean {
	return value.startsWith('data:') && value.length > DATA_URI_URL_REFS_LIMIT;
}
