import type { MainContentCustomElementCandidate } from './types.js';

/**
 * Collects every Web Component (custom element) inside a page's main-content
 * region — its `nodeName`, `id`, and `classList` — in document order.
 *
 * **Self-contained by contract.** Passed verbatim to Puppeteer's
 * `page.evaluate`, which serialises the function source and executes it
 * inside the browser: it must not reference imports, module-scope bindings,
 * or any closure state. This is why the main-content selector priority
 * lists below are inlined rather than imported from
 * `@d-zero/beholder`'s `main-content-selectors.ts` — the same
 * closure-free constraint that forces beholder's own
 * `extractMainContentsFromDocument` to inline them. The two copies (this
 * file's and beholder's) are kept in sync by
 * {@link ./collect-custom-elements.spec.ts}, which asserts the resolved
 * main element matches beholder's own resolution for the same fixture.
 *
 * A "custom element" here means: the tag name (case-insensitively)
 * contains a hyphen, and is not one of the eight hyphenated SVG/MathML
 * element names the Custom Elements spec reserves as non-registrable
 * (`annotation-xml`, `color-profile`, `font-face`, `font-face-src`,
 * `font-face-uri`, `font-face-format`, `font-face-name`, `missing-glyph`).
 * @param mainContentSelector - Optional selector prepended to the default
 *   list, mirroring beholder's `getMainContents` option of the same name.
 * @param doc - The document to walk. Defaults to the global `document`,
 *   which is how the in-browser `page.evaluate(collectCustomElements, sel)`
 *   call resolves it; Node callers (specs) pass a jsdom document.
 * @returns Candidates in document order, or an empty array when no
 *   main-content region can be resolved.
 * @example
 * const candidates = await page.evaluate(collectCustomElements, mainContentSelector);
 */
export function collectCustomElements(
	mainContentSelector: string | null = null,
	doc: Document = document,
): MainContentCustomElementCandidate[] {
	// Kept in sync with beholder's MAIN_CONTENT_SELECTORS
	// (main-content-selectors.ts) — see the module JSDoc. Inlined rather
	// than imported because this function must stay closure-free.
	const selectors = [
		'main',
		'[role="main"]',
		'#main',
		'.main',
		'#content',
		'.content',
		'#contents',
		'.contents',
		'#main-content',
		'.main-content',
		'#main_content',
		'.main_content',
		'#mainContent',
		'.mainContent',
	];
	if (mainContentSelector) {
		selectors.unshift(mainContentSelector);
	}

	let $main: Element | null = null;
	for (const sel of selectors) {
		try {
			$main = doc.querySelector(sel);
		} catch {
			continue;
		}
		if ($main) {
			break;
		}
	}

	if (!$main) {
		// Kept in sync with beholder's MAIN_CONTENT_FALLBACK_SELECTORS.
		const fallbackSelectors = [
			'[id*="main" i]',
			'[class*="main" i]',
			'[id*="content" i]',
			'[class*="content" i]',
		];
		for (const sel of fallbackSelectors) {
			const candidate = doc.querySelector(sel);
			if (candidate && candidate !== doc.body && candidate !== doc.documentElement) {
				$main = candidate;
				break;
			}
		}
	}

	if (!$main) return [];

	// The eight hyphenated element names the Custom Elements spec reserves
	// as non-registrable (SVG/MathML legacy names) — the sole exception to
	// "a hyphenated tag name is a custom element".
	const reservedHyphenatedNames = new Set([
		'annotation-xml',
		'color-profile',
		'font-face',
		'font-face-src',
		'font-face-uri',
		'font-face-format',
		'font-face-name',
		'missing-glyph',
	]);

	const candidates: MainContentCustomElementCandidate[] = [];
	for (const el of $main.querySelectorAll('*')) {
		const tagName = el.nodeName.toLowerCase();
		if (!tagName.includes('-') || reservedHyphenatedNames.has(tagName)) continue;
		candidates.push({
			nodeName: el.nodeName,
			elementId: el.id || null,
			classList: [...el.classList],
		});
	}
	return candidates;
}
