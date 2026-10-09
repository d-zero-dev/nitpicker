import type { DomPathCandidate, DomPathResult } from './types.js';

/**
 * One image record projected onto the fields the matcher needs:
 * `id` (used to build the returned Map) and `sourceCode` (the outerHTML
 * string to match against document candidates). `id` may be a real
 * `images.id` (migration) or a synthetic per-page index (crawler write
 * path) — the matcher only requires ids to be unique within one call and
 * ordered in crawler insertion order.
 */
interface ImageRowForMatching {
	/** Unique-within-call id, in crawler insertion order. */
	id: number;
	/**
	 * The `<img>` element's `outerHTML` as captured by the crawler.
	 * `null` when the crawler failed to capture the source (a null blob
	 * or a puppeteer serialisation edge case).
	 */
	sourceCode: string | null;
}

/**
 * Matches image records to their DOM-path strings using a 3-case
 * algorithm (issue #193).
 *
 * The three cases:
 *
 * 1. **Single match** — `image.sourceCode` matches exactly one `<img>`
 *    outerHTML in the document. Assign that candidate's `dom_path`.
 * 2. **Ordinal match** — multiple `<img>` elements share the same
 *    outerHTML (identical `src` / `alt` / attributes on the same page).
 *    Assign paths in `id` order, matching the crawler's insertion order
 *    which is expected to correspond to DOM order.
 * 3. **Unknown** — `sourceCode` is null OR no matching `<img>` exists
 *    in the document (crawler-side rewriting drift). Fall back to the
 *    synthetic `unknown/<id>` marker so the `dom_path_text_id NOT NULL`
 *    constraint is still satisfied.
 *
 * The function is pure — no DB, no DOM. Callers produce the candidate
 * list from whatever DOM they have: jsdom over an archived HTML snapshot
 * (migration script) or an in-browser walk over the live page (crawler
 * write path). See {@link ./types.ts}'s `DomPathCandidate`.
 *
 * `candidatesInDocumentOrder` MUST already be in document order — the
 * matcher does not sort. `document.querySelectorAll('img')` satisfies
 * this contract; ordering is the caller's responsibility.
 *
 * `images` MUST already be sorted by `id` ascending for the ordinal-
 * match case to reproduce the crawler's insertion order deterministically.
 * A minor deviation from this ordering only affects the ordinal-match
 * branch — single-match and unknown branches are order-independent.
 * @param images - The page's image records in `id` order.
 * @param candidatesInDocumentOrder - `<img>` outerHTML + dom_path pairs
 *   from the document, in document order.
 * @returns Map keyed by `images[].id`; every input row gets one entry.
 * @example
 * const jsdom = new JSDOM(html);
 * const candidates = [...jsdom.window.document.querySelectorAll('img')].map(
 *   (img) => ({ outerHTML: img.outerHTML, path: deriveDomPath(img) }),
 * );
 * const result = matchImagesToDomPaths(
 *   [{ id: 1, sourceCode: '<img src="a.png">' }],
 *   candidates,
 * );
 * result.get(1); // { path: 'html/body[1]/img[1]', case: 'single-match' }
 */
export function matchImagesToDomPaths(
	images: readonly ImageRowForMatching[],
	candidatesInDocumentOrder: readonly DomPathCandidate[],
): ReadonlyMap<number, DomPathResult> {
	const byOuterHtml = new Map<string, DomPathCandidate[]>();
	for (const candidate of candidatesInDocumentOrder) {
		const bucket = byOuterHtml.get(candidate.outerHTML);
		if (bucket === undefined) {
			byOuterHtml.set(candidate.outerHTML, [candidate]);
		} else {
			bucket.push(candidate);
		}
	}

	const cursorByOuterHtml = new Map<string, number>();
	const result = new Map<number, DomPathResult>();
	for (const image of images) {
		if (image.sourceCode === null || image.sourceCode === '') {
			result.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
			continue;
		}
		const candidates = byOuterHtml.get(image.sourceCode);
		if (candidates === undefined || candidates.length === 0) {
			result.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
			continue;
		}
		if (candidates.length === 1) {
			result.set(image.id, {
				path: candidates[0]!.path,
				case: 'single-match',
			});
			continue;
		}
		const cursor = cursorByOuterHtml.get(image.sourceCode) ?? 0;
		cursorByOuterHtml.set(image.sourceCode, cursor + 1);
		const chosen = candidates[cursor];
		if (chosen === undefined) {
			// More image records share this outerHTML than the document
			// has matching `<img>` elements. Reusing the last candidate
			// (`candidates.at(-1)`) would silently map every overflow row
			// to the same element, producing multiple `image_items` rows
			// with the same `dom_path_text_id`. Falling back to
			// `unknown/<id>` keeps overflow rows individually
			// distinguishable in the archive.
			result.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
			continue;
		}
		result.set(image.id, {
			path: chosen.path,
			case: 'ordinal-match',
		});
	}
	return result;
}
