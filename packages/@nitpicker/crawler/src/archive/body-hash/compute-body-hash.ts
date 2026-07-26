import { computeContentHash } from '../populate-ref-tables/compute-content-hash.js';

import { extractBody } from './extract-body.js';
import { maskDynamicIds } from './mask-dynamic-ids.js';
import { normalizeUrlLikeStrings } from './normalize-url-like-strings.js';

/**
 * Computes a content hash of a page's `<body>`, after normalizing away the
 * kinds of incidental variance that would otherwise make two structurally
 * identical pages hash differently: `/index.{ext}` URL-suffix forms and
 * embedded dynamic tokens (cache-busting hashes, session/order ids, per-build
 * CSS-module suffixes).
 *
 * Only the resulting hash is persisted (`page_meta.body_hash`) — the masked
 * intermediate string is never stored. The unmasked original HTML remains
 * fully recoverable from `page_html_blobs`, so nothing is lost by discarding
 * it here.
 * @param html - A full HTML document string (or fragment).
 * @returns 32-byte SHA-256 hash of the masked `<body>` content, ready to
 *   insert into a `BLOB` column.
 * @example
 * ```ts
 * const hashA = computeBodyHash('<body><a href="/p/a1b2c3d4">x</a></body>');
 * const hashB = computeBodyHash('<body><a href="/p/z9y8x7w6">x</a></body>');
 * hashA.equals(hashB); // true — the differing token is masked before hashing
 * ```
 */
export function computeBodyHash(html: string): Buffer {
	const body = extractBody(html);
	const normalized = normalizeUrlLikeStrings(body);
	const masked = maskDynamicIds(normalized);
	return computeContentHash(masked);
}
