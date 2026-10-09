import type Archive from '@nitpicker/archive/archive';

import { classifyArchivePageTemplates } from '@nitpicker/archive/template-classification/classify-archive-page-templates';

import { dedupeProgressMessage } from '../dedupe-progress-message.js';

import { formatTemplateClassificationProgress } from './format-template-classification-progress.js';

/**
 * Runs the DOM-structure template classification against an archive that is
 * about to be written: a just-finished crawl, an archive opened by
 * `viewer-build`, or a freshly produced `concat` / `split` output. Always
 * runs immediately before the viewer read-model build, so the build (and any
 * future read-model column derived from `page_templates`) sees the new
 * classification.
 *
 * Never throws: classification is a best-effort derived-data step, so a
 * clustering failure must not prevent the archive itself from being written
 * — the same contract as `scanJsResourcesQuietly` and
 * `ensureViewerReadModelQuietly`. The outcome is reported through
 * `onProgress` when one is provided (the completion summary and a failure
 * both). This runs while the caller's own task-list row is active, where a
 * bare `console.error` corrupts dealer's cursor tracking (see
 * `scan-js-resources-quietly.ts`), so `onProgress` is the only channel while
 * a display exists. It is only omitted under `--silent`, which has no display
 * to corrupt: there the success summary is dropped (`--silent` means no log
 * output) and only a failure still reaches `console.error`, so a skipped
 * classification is never invisible.
 *
 * The caller owns display: `onProgress` receives only the message fragment,
 * never a label or animation marker, since the task-list row carries both.
 * @param archive - A writable `Archive`.
 * @param onProgress - Called with the rendered progress / summary message
 *   whenever it changes. Omit for no progress reporting (a failure still goes
 *   to `console.error`).
 * @returns `null` on success, or the failure message — `concat` / `split`
 *   surface it as an exit-code-bearing notice; the other callers ignore it.
 * @example
 * ```ts
 * const error = await classifyTemplatesQuietly(archive, (message) => {
 *   ctx.progress(message);
 * });
 * ```
 */
export async function classifyTemplatesQuietly(
	archive: Archive,
	onProgress?: (message: string) => void,
): Promise<string | null> {
	const reportProgress = dedupeProgressMessage((message) => {
		onProgress?.(message);
	});
	try {
		const result = await classifyArchivePageTemplates(archive, {
			onProgress: (event) => {
				reportProgress(formatTemplateClassificationProgress(event));
			},
		});
		const message =
			result.classifiedPageCount === 0
				? 'No pages to classify'
				: `${result.classifiedPageCount.toLocaleString()} page(s) in ${result.templateCount.toLocaleString()} template(s)`;
		onProgress?.(message);
		return null;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		const message = `Classify page templates failed, continuing without it: ${reason}`;
		if (onProgress) {
			onProgress(message);
		} else {
			// eslint-disable-next-line no-console -- --silent has no TaskList row to report through
			console.error(`[nitpicker] ${message}`);
		}
		return reason;
	}
}
