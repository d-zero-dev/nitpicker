/**
 * Ordered `SetupProgressCallbacks.onPhase` labels
 * `CrawlerOrchestrator.retryFailed` announces, in call order, before its
 * `initializedCallback` fires. Single source of truth for both the `onPhase`
 * call sites in `crawler-orchestrator.ts` and the CLI's setup task list
 * (`create-setup-task-list.ts`), which pre-builds one task-list row per
 * entry — duplicating this sequence by hand at the CLI layer would silently
 * drift the moment a phase is added, renamed, or reordered here.
 *
 * Linear on the success path (no branching before `initializedCallback`). On
 * failure — anywhere from `archive.resetFailedPages` through the crawl
 * itself — a `SETUP_RECOVERY_PHASE_LABELS` entry
 * (`'Restoring archive from backup'`) is announced instead of continuing
 * this sequence.
 */
export const RETRY_FAILED_SETUP_PHASES = [
	'Extracting archive',
	'Loading archive config',
	'Backing up archive',
	'Resetting failed pages',
	'Loading dedupe-cap shape keys',
	'Loading crawl state',
	'Loading resource list',
	'Loading scraped page count',
	'Restoring crawl state',
] as const;
