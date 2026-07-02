import type { ViewerReadModelBuildProgress } from '@nitpicker/query';

/**
 * Formats a `buildViewerReadModel`/`ensureViewerReadModel` progress update
 * for stderr — shared by the crawl-completion hook
 * (`ensure-viewer-read-model-quietly.ts`) and the explicit `viewer-build`
 * command so the two call sites can't drift into inconsistent wording.
 * @param progress - The current insert progress.
 * @returns A one-line, human-readable progress message.
 */
export function formatViewerReadModelProgress(
	progress: ViewerReadModelBuildProgress,
): string {
	return `[nitpicker] building viewer read model: ${progress.insertedRows}/${progress.totalRows} pages`;
}
