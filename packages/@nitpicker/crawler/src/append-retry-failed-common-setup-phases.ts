/**
 * The setup-phase labels `append()` and `retryFailed()` announce identically
 * — everything except the one step in between that names what each mode is
 * actually doing (`'Repromoting external pages'` vs `'Resetting failed
 * pages'`) — split into a `prefix` (before that step) and `suffix` (after
 * it). Single source of truth for `APPEND_SETUP_PHASES` /
 * `RETRY_FAILED_SETUP_PHASES` (issue #294): the two were previously
 * hand-written as independent nine-entry literal arrays sharing eight of
 * nine entries verbatim, with nothing to catch one drifting from the other
 * if a shared phase were added, renamed, or reordered in only one place.
 */
export const APPEND_RETRY_FAILED_COMMON_SETUP_PHASES = {
	prefix: ['Extracting archive', 'Loading archive config', 'Backing up archive'],
	suffix: [
		'Loading dedupe-cap shape keys',
		'Loading crawl state',
		'Loading resource list',
		'Loading scraped page count',
		'Restoring crawl state',
	],
} as const;
