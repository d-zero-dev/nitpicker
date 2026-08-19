/**
 * Human-readable label for each `Archive.write()` step (issue #294), shared
 * by `viewer-build.ts` and `crawl/run-post-crawl-task-list.ts` (the crawl
 * commands' write progress) so the two can't drift into inconsistent wording
 * for the same step. `checkpoint` and `remove` have no countable progress of their own (a
 * single synchronous PRAGMA and a directory removal, respectively), so
 * without a label the display would sit static — indistinguishable from a
 * stall — for however long those steps take. `tar`'s label is immediately
 * superseded by its own byte-progress line; it is included here anyway so
 * there is no gap between the step starting and the first progress update.
 */
export const WRITE_STEP_LABELS: Record<
	'checkpoint' | 'rename' | 'tar' | 'remove',
	string
> = {
	checkpoint: 'Checkpointing database',
	rename: 'Finalizing archive layout',
	tar: 'Writing archive',
	remove: 'Removing temporary files',
};
