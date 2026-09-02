/**
 * Ordered `SetupProgressCallbacks.onPhase` labels
 * `CrawlerOrchestrator.recrawl` announces, in call order, before its
 * `initializedCallback` fires. Single source of truth for both the `onPhase`
 * call sites in `crawler-orchestrator.ts` and the CLI's setup task list
 * (`create-setup-task-list.ts`), which pre-builds one task-list row per
 * entry — duplicating this sequence by hand at the CLI layer would silently
 * drift the moment a phase is added, renamed, or reordered here.
 *
 * Identical to `INVENTORY_SETUP_PHASES` except for one extra step —
 * `'Resetting matched pages'`, right after `'Backing up archive'` — since
 * `recrawl` un-scrapes URLs that already exist as pages in addition to
 * importing the URLs `inventory` handles (novel URLs the archive does not
 * yet track). This is the **superset** sequence — `recrawl` has three
 * `initializedCallback` call sites, each reached after a different prefix of
 * this list depending on the input:
 * - no matched pages AND no novel URLs (everything already known / out of
 *   scope): stops after index 3 (`'Checking for already-known URLs'`), skips
 *   the `.bak` backup entirely
 * - novel URLs are all non-HTML and nothing was reset: stops after index 8
 *   (`'Recording excluded pages'`) — nothing to render, no crawl state to
 *   rebuild
 * - at least one reset page or novel HTML seed: runs the full 13-phase
 *   sequence
 *
 * The CLI's setup task list pre-builds all 13 rows and marks whichever
 * suffix never got announced as skipped once `initializedCallback` fires —
 * it does not need to know in advance which of the three prefixes a given
 * run will take. Note `'Loading crawl state'` appears twice (indices 2 and
 * 9): the first read is scoped to the pre-ingestion pending-URL warning, the
 * second re-reads state after the reset pages and new inventory seeds have
 * been written.
 *
 * On failure, a `SETUP_RECOVERY_PHASE_LABELS` entry
 * (`'Restoring archive from backup'` or `'Persisting ingested inventory
 * state'`) is announced instead of continuing this sequence.
 */
export const RECRAWL_SETUP_PHASES = [
	'Extracting archive',
	'Loading archive config',
	'Loading crawl state',
	'Checking for already-known URLs',
	'Backing up archive',
	'Resetting matched pages',
	'Recording non-HTML resources',
	'Recording HTML seed pages',
	'Recording excluded pages',
	'Loading crawl state',
	'Loading resource list',
	'Loading scraped page count',
	'Restoring crawl state',
] as const;
