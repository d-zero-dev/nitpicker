import type {
	PageClusterSignals,
	PageFactory,
} from '@d-zero/page-cluster/resolve-page-cluster-keys';
import type { Page } from '@nitpicker/crawler';

/**
 * Builds the `PageFactory` that `@d-zero/page-cluster`'s
 * `resolvePageClusterKeys` reads the corpus through, plus a way to read back
 * the URL list it actually yielded (see below for why that can't be known
 * synchronously up front).
 *
 * Only internal HTML pages (`Page.isInternalPage()` — content-type based,
 * matching the "a page is judged by content-type, not `isTarget`" archive
 * invariant) with retrievable HTML are yielded. A page can be an internal
 * HTML page and still have no retrievable HTML (e.g. a skipped or
 * self-heal-affected row) — `page.getHtml()` returning falsy is only known
 * by actually calling it, not from any synchronous field.
 *
 * `resolvePageClusterKeys` calls the returned factory one or more times
 * (once for corpora at or below its inline threshold, twice above it — see
 * its own docs) to re-read the corpus. Whichever pages end up excluded
 * (empty HTML) must be excluded **identically** on every call, or the
 * pass-to-pass page sequence drifts and the library's same-order contract
 * breaks. Excluding by `isInternalPage()` is safe (synchronous,
 * deterministic per page). Excluding by empty `getHtml()` is also safe,
 * but only because the archive is immutable for the duration of one
 * `analyze()` run — the same page's HTML never changes between calls.
 *
 * `getYieldedUrls()` reflects the URLs yielded by the **most recently
 * completed** full iteration of the factory's generator, deliberately not a
 * separate up-front probe pass over every candidate's HTML: every documented
 * call shape of `resolvePageClusterKeys` fully drains the factory it's given
 * (that's what "reading the factory" means in its own docs), so by the time
 * `resolvePageClusterKeys` resolves, at least one full drain has already
 * happened and `getYieldedUrls()` reflects it — a dedicated probe pass would
 * only add a full corpus-wide decompression sweep beyond the library's own
 * 1-2, for no benefit. `classifyPageTemplates` still defends against a
 * violated assumption here with a hard length check against
 * `resolvePageClusterKeys`'s result array.
 * @param pages - Candidate pages (as already loaded by `Nitpicker.analyze()`
 *   — this function does not re-query the archive).
 * @param stylesheetsByUrl - Output of `collectPageStylesheetUrls`, keyed by
 *   `page.url.href`.
 * @returns `factory` to pass to `resolvePageClusterKeys`, and
 *   `getYieldedUrls()` — call this only *after* `resolvePageClusterKeys`
 *   resolves; its result array has exactly the length and order of
 *   `getYieldedUrls()` at that point.
 * @example
 * ```ts
 * const { factory, getYieldedUrls } = createPageClusterFactory(pages, stylesheetsByUrl);
 * const clusterKeys = await resolvePageClusterKeys(factory);
 * const yieldedUrls = getYieldedUrls(); // safe to read now
 * ```
 */
export function createPageClusterFactory(
	pages: readonly Page[],
	stylesheetsByUrl: ReadonlyMap<string, readonly string[]>,
): { factory: PageFactory; getYieldedUrls: () => readonly string[] } {
	const candidates = pages.filter((page) => page.isInternalPage());
	let yieldedUrls: readonly string[] = [];

	const factory: PageFactory = () =>
		yieldPageClusterSignals(candidates, stylesheetsByUrl, (urls) => {
			yieldedUrls = urls;
		});

	return { factory, getYieldedUrls: () => yieldedUrls };
}

/**
 * The actual per-call iterator body for {@link createPageClusterFactory}'s
 * `PageFactory`. HTML is fetched lazily, one page at a time, so the archive
 * never holds more than one page's decompressed HTML in memory regardless
 * of corpus size — matching `@d-zero/page-cluster`'s own memory-bounding
 * design for its multi-pass reads.
 * @param candidates - Pre-filtered internal HTML pages, in fixed order.
 * @param stylesheetsByUrl - See {@link createPageClusterFactory}.
 * @param onDrained - Called with every yielded URL, in order, once this
 *   particular iteration reaches the end of `candidates` — never called if
 *   the consumer stops iterating early.
 * @yields {PageClusterSignals} One per candidate page with retrievable HTML.
 */
async function* yieldPageClusterSignals(
	candidates: readonly Page[],
	stylesheetsByUrl: ReadonlyMap<string, readonly string[]>,
	onDrained: (yieldedUrls: readonly string[]) => void,
): AsyncGenerator<PageClusterSignals> {
	const yieldedUrls: string[] = [];
	for (const page of candidates) {
		const html = await page.getHtml();
		if (!html) {
			continue;
		}

		const url = page.url;
		yieldedUrls.push(url.href);
		yield {
			paths: url.paths,
			stylesheetHrefs: stylesheetsByUrl.get(url.href) ?? [],
			html,
			host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
		};
	}
	onDrained(yieldedUrls);
}
