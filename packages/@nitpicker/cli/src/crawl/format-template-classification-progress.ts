import type { TemplateClassificationProgress } from '@nitpicker/crawler';

import { formatProgressCount } from '../format-progress-count.js';

/**
 * Renders one template-classification progress event as the short message of
 * the `'Classify page templates'` task-list row. Every event that carries both
 * halves of a done/total pair renders through {@link formatProgressCount} (the
 * `N/M unit (X%)` convention every other row uses); `pass0-signals` and
 * `stage-b-start` carry only a running count with no corpus-wide total, so
 * those two render count-only. The count-less step announcements
 * (`loading-pages-start`, `collecting-stylesheets`, `writing-results`) name the
 * multi-second step that just began, so the row never sits on the previous
 * step's last message.
 *
 * No `%braille%` / `%dots%` placeholder: a `TaskList` row's own
 * `[%taskSpin%]` icon is the animation (see `cli/CLAUDE.md`).
 * @param event - Progress event from `classifyArchivePageTemplates`.
 * @returns A short status fragment, e.g. `"3/12 blocks (25%)"`.
 * @example
 * ```ts
 * formatTemplateClassificationProgress({
 *   phase: 'loading-pages', done: 250, total: 500,
 * }); // "loading 250/500 pages (50%)"
 * ```
 */
export function formatTemplateClassificationProgress(
	event: TemplateClassificationProgress,
): string {
	switch (event.phase) {
		case 'loading-pages-start': {
			return 'loading pages';
		}
		case 'collecting-stylesheets': {
			return 'collecting stylesheet references';
		}
		case 'writing-results': {
			return `saving ${event.templateCount.toLocaleString()} template(s)`;
		}
		case 'loading-pages': {
			return `loading ${formatProgressCount(event.done, event.total, 'pages')}`;
		}
		case 'pass0-signals': {
			return `reading pages (${event.pagesSeen.toLocaleString()})`;
		}
		case 'pass1-block-complete': {
			return formatProgressCount(event.blocksProcessed, event.totalBlocks, 'blocks');
		}
		case 'pass1b-assign': {
			return `assigning ${formatProgressCount(event.pagesAssigned, event.pagesToAssign, 'pages')}`;
		}
		case 'stage-b-start': {
			return `merging ${event.unitCount.toLocaleString()} units`;
		}
	}
}
