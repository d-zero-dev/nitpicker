/* eslint-disable no-console */

import { parse, serializeOuter } from 'parse5';

import { deriveDomPath } from '../packages/@nitpicker/crawler/lib/archive/populate-entity-tables/derive-dom-path.js';
import { matchImagesToDomPaths } from '../packages/@nitpicker/crawler/lib/archive/populate-entity-tables/match-images-to-dom-paths.js';

import { findElementsByTagName } from './find-elements-by-tag-name.mjs';
import { Parse5ElementAdapter } from './parse5-element-adapter.mjs';

/**
 * Returns a `PageDomPathResolver` (see
 * `packages/@nitpicker/crawler/src/archive/populate-entity-tables/populate-image-items.ts`)
 * that parses HTML with parse5 and applies the 3-case match algorithm
 * from `match-images-to-dom-paths.ts`.
 *
 * parse5 produces a plain-object AST with no backing V8 `vm` context
 * (unlike jsdom, which runs every parsed document inside its own
 * `Window`'s `vm` context — a context V8 does not reliably reclaim even
 * with a forced `globalThis.gc()` call between pages, see git history
 * for the measurement). Parsing with parse5 instead removes the
 * per-page memory retention outright, so `scripts/migrate-to-0.13.mjs`
 * can call this resolver directly, in-process, with no worker pool or
 * recycling needed.
 *
 * parse5's HTML5 tokenizer is error-tolerant by spec — malformed input
 * still parses to *some* tree rather than throwing — so the `catch`
 * branch below is defensive symmetry with the "no HTML snapshot"
 * fallback rather than a path expected to trigger in practice.
 */
export function createDomPathResolver() {
	return async (pageId, htmlString, images) => {
		if (htmlString === null) {
			// Every image on this page falls back — emit a per-image
			// warning so operators can audit reconstruction fidelity,
			// not just a single "no HTML for page X" line.
			return fallbackAllUnknown(images, pageId, 'no HTML snapshot stored');
		}
		let document;
		try {
			document = parse(htmlString);
		} catch (error) {
			return fallbackAllUnknown(
				images,
				pageId,
				`parse5 parse failed: ${error?.message ?? error}`,
			);
		}
		const candidates = findElementsByTagName(document, 'img').map((node) => ({
			outerHTML: serializeOuter(node),
			path: deriveDomPath(new Parse5ElementAdapter(node)),
		}));
		const result = matchImagesToDomPaths(images, candidates);
		for (const [imageId, entry] of result) {
			if (entry.case === 'unknown') {
				console.warn(
					`[dom-path] unknown fallback for image id=${imageId} (page ${pageId})`,
				);
			}
		}
		return result;
	};
}

/**
 * Returns a `Map<imageId, DomPathResult>` where every image resolves to
 * the `unknown/<id>` fallback and emits one warning line per image so
 * the audit log records a warning for every `unknown/*` fallback —
 * the contract operators rely on to audit reconstruction fidelity.
 * Used when parse5 cannot parse the page OR when the page has no
 * stored HTML snapshot at all.
 * @param {readonly { id: number }[]} images
 * @param {number} pageId
 * @param {string} reason - Human-readable reason for the whole-page fallback.
 */
function fallbackAllUnknown(images, pageId, reason) {
	const map = new Map();
	for (const image of images) {
		map.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
		console.warn(
			`[dom-path] unknown fallback for image id=${image.id} (page ${pageId}): ${reason}`,
		);
	}
	return map;
}
