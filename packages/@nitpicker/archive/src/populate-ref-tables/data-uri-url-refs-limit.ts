/**
 * Threshold above which a `data:` URI is treated as a `blob_refs` payload
 * rather than a `url_refs` URL. Shared between {@link ./populate-url-refs.ts}
 * (which excludes `> LIMIT` data URIs from `url_refs`) and
 * {@link ./populate-blob-refs.ts} (which routes them to `blob_refs`).
 *
 * The two populators MUST agree on this constant — a mismatch creates a
 * routing hole where URIs of the disputed length land in neither table.
 * Keeping the value here as a single-file export makes drift impossible.
 *
 * 512 was chosen because well-formed http(s) URLs virtually never exceed
 * 512 characters in practice, while the smallest observed data URIs are
 * ~600 bytes.
 */
export const DATA_URI_URL_REFS_LIMIT = 512;
