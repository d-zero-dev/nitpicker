import type {
	HtmlRead,
	PageClusterKeys,
	PageClusterPage,
	PageFactory,
	ResolvePageClusterKeysOptions,
	SignalsRead,
} from './types.js';
import type { TemplatePageHtml } from '@nitpicker/core/types';

import { createTemplateClassificationRun } from '@nitpicker/core/create-template-classification-run';

/** Pages whose signals are handed to the run per call. */
const SIGNALS_PER_BATCH = 1000;

/**
 * Pages a read uses handed to the native run per call (the pages it does
 * not use ride along without counting): enough to keep its thread pool busy
 * on one call, few enough that the next batch is read while it runs. Only
 * throughput depends on it, never the keys.
 */
const PAGES_PER_BATCH = 64;

/**
 * HTML (in UTF-16 code units) handed to the native run per call, at most, so
 * a batch of unusually large pages does not hold their copies all at once.
 * Only memory and throughput depend on it, never the keys.
 */
const HTML_PER_BATCH = 32 * 1024 * 1024;

/**
 * Pages whose HTML is being read at once, ahead of the one the batch takes
 * next. Each read is a database query and a decompression, so one at a time
 * leaves the native run waiting for the next batch (on a ~178,000-page
 * archive, reading ahead took classification from 139 s to 110 s); a few at
 * a time keeps it busy while bounding the HTML held in flight. Only
 * throughput and memory depend on it, never the keys (pages still enter
 * batches in order).
 */
const HTML_READ_AHEAD = 16;

/** What a page a read does not use is handed over as. */
const UNUSED_PAGE: TemplatePageHtml = Object.freeze({ html: '' });

/**
 * The error for a factory that yields a different corpus on a later read.
 * @param produced How many pages the read produced: its exact count, or
 *   `{ moreThan }` the first read's count when it was cut short at the
 *   first page beyond it (the rest is not read).
 * @param expected
 */
function factoryMismatch(
	produced: number | { readonly moreThan: number },
	expected: number,
): Error {
	const producedText =
		typeof produced === 'number'
			? `${produced} pages`
			: `more than ${produced.moreThan} pages`;
	return new Error(
		`resolvePageClusterKeys: a read of the page factory produced ${producedText} but the first read saw ${expected} — the factory must produce the same pages in the same order on every call`,
	);
}

/**
 * The page as one read hands it to the run: its HTML and content-root hint
 * when the read uses it, the shared empty page otherwise.
 * @param page
 * @param used
 */
async function toPageHtml(
	page: PageClusterPage,
	used: boolean,
): Promise<TemplatePageHtml> {
	if (!used) {
		// A page the read does not use costs the run nothing, so it only holds
		// its place in the corpus order.
		return UNUSED_PAGE;
	}
	const html = await page.getHtml();
	return {
		html,
		...(page.contentRoot ? { contentRoot: page.contentRoot } : {}),
	};
}

/**
 * Reads `pages` once and hands them to `push` in batches, reading the HTML
 * only of the pages `mask` marks (the others go with empty HTML, which the
 * run does not read). The HTML of up to {@link HTML_READ_AHEAD} pages is read
 * at once, and a batch is read while the previous one is processed (the
 * native run works off Node's main thread); each push is awaited before the
 * next one starts, as the run requires.
 *
 * Only the page count is checked against the first read: a factory yielding
 * as many pages but different ones, or in another order, goes unnoticed.
 * @param read
 * @param read.pages
 * @param read.mask The run's `pageMask()` for this read; its length is the
 *   page count of the first read.
 * @param read.push
 */
async function streamPages(read: HtmlRead): Promise<void> {
	const { pages, mask, push } = read;
	let inFlight: Promise<void> = Promise.resolve();
	let batch: TemplatePageHtml[] = [];
	let usedInBatch = 0;
	let batchLength = 0;
	let pagesRead = 0;
	const reading: Promise<TemplatePageHtml>[] = [];
	let pushFailure: { readonly error: unknown } | undefined;
	const flush = async () => {
		await inFlight;
		inFlight = push(batch);
		// Read on while it runs; a rejection is noted here (so it does not
		// count as unhandled) and stops the reading at the next page.
		inFlight.catch((error: unknown) => {
			pushFailure ??= { error };
		});
		batch = [];
		usedInBatch = 0;
		batchLength = 0;
	};
	const takeNext = async () => {
		const entry = await reading.shift()!;
		batch.push(entry);
		if (entry === UNUSED_PAGE) return;
		usedInBatch++;
		batchLength += entry.html.length;
		if (usedInBatch >= PAGES_PER_BATCH || batchLength >= HTML_PER_BATCH) {
			await flush();
		}
	};
	try {
		for await (const page of pages()) {
			if (pushFailure) throw pushFailure.error;
			if (pagesRead >= mask.length) {
				throw factoryMismatch({ moreThan: mask.length }, mask.length);
			}
			const entry = toPageHtml(page, mask[pagesRead] === 1);
			// Awaited in order by `takeNext`; until then a rejection must not
			// count as unhandled.
			entry.catch(() => {});
			reading.push(entry);
			pagesRead++;
			if (reading.length > HTML_READ_AHEAD) {
				await takeNext();
			}
		}
		while (reading.length > 0) {
			await takeNext();
		}
	} catch (error) {
		// Let the running call and the HTML reads already started settle
		// before the caller cancels the run (and perhaps closes the archive),
		// so nothing is left working on a run that is being given up.
		await inFlight.catch(() => {});
		await Promise.allSettled(reading);
		throw error;
	}
	if (batch.length > 0) {
		await flush();
	}
	await inFlight;
	if (pagesRead !== mask.length) {
		throw factoryMismatch(pagesRead, mask.length);
	}
}

/**
 * Reads every page's blocking signals into `run`, reporting every 1,000
 * pages.
 * @param read
 * @param read.pages
 * @param read.run
 * @param read.onProgress
 */
async function pushSignals(read: SignalsRead): Promise<void> {
	const { pages, run, onProgress } = read;
	let pagesSeen = 0;
	let batch: PageClusterPage[] = [];
	for await (const page of pages()) {
		if (onProgress && pagesSeen > 0 && pagesSeen % SIGNALS_PER_BATCH === 0) {
			onProgress({ phase: 'pass0-signals', pagesSeen });
		}
		pagesSeen++;
		batch.push(page);
		if (batch.length >= SIGNALS_PER_BATCH) {
			run.pushSignals(batch);
			batch = [];
		}
	}
	run.pushSignals(batch);
}

/**
 * Clusters pages into templates by DOM structure, in the native addon
 * (`@nitpicker/core`'s `createTemplateClassificationRun`):
 *
 * - **Pass 0** splits the corpus into blocks by URL section and first-party
 *   stylesheets, from the signals alone — no HTML.
 * - **Stage A** clusters each block: landmark chrome is cut out, the content
 *   depth is capped at the block's knee, and complete-linkage clustering
 *   with a max-gap cut splits the block.
 * - **Stage B** merges clusters across blocks and explains each final one.
 *
 * At or below `TEMPLATE_CORPUS_INLINE_THRESHOLD` (20,000) pages every page
 * is clustered and chrome is judged across the corpus. Above it — the
 * streaming path — each block is clustered on a sample and a further read
 * assigns the rest. The factory is read twice (signals, HTML) or, streaming
 * with pages outside the samples, three times; each page's HTML is read
 * once, and JavaScript never holds the whole corpus's HTML.
 * @param pages
 * @param options
 * @example
 * ```ts
 * const { keys, reasons } = await resolvePageClusterKeys(() => [
 * 	{ paths: ['news', '1'], stylesheetHrefs: [], getHtml: () => '<body><article>one</article></body>' },
 * 	{ paths: ['news', '2'], stylesheetHrefs: [], getHtml: () => '<body><article>two</article></body>' },
 * 	{ paths: ['about'], stylesheetHrefs: [], getHtml: () => '<body><section>about</section></body>' },
 * ]);
 * // keys: ['["path:news","cluster:0"]', '["path:news","cluster:0"]', '["path:about","cluster:0"]']
 * // reasons: one per cluster key, e.g. reasons.get('["path:about","cluster:0"]')?.memberCount === 1
 * ```
 */
export async function resolvePageClusterKeys(
	pages: PageFactory,
	options?: Partial<ResolvePageClusterKeysOptions>,
): Promise<PageClusterKeys> {
	const onProgress = options?.onProgress;
	const run = createTemplateClassificationRun(onProgress ? { onProgress } : {});
	try {
		await pushSignals({ pages, run, onProgress });
		await run.block();
		await streamPages({
			pages,
			mask: run.pageMask(),
			push: (batch) => run.pushPages(batch),
		});
		await run.finishPages();
		if (run.needsAssignment()) {
			await streamPages({
				pages,
				mask: run.pageMask(),
				push: (batch) => run.pushAssignmentPages(batch),
			});
		}
		const output = await run.takeOutput();
		return {
			keys: Array.from(output.keyOfPage, (key) => output.keys[key]!),
			reasons: output.reasons,
		};
	} catch (error) {
		run.cancel();
		throw error;
	}
}
