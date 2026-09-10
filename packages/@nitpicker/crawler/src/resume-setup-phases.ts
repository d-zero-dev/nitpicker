/**
 * Ordered `SetupProgressCallbacks.onPhase` labels `CrawlerOrchestrator.resume`
 * announces, in call order, before its `initializedCallback` fires. Single
 * source of truth for both the `onPhase` call sites in
 * `crawler-orchestrator.ts` and the CLI's setup task list (`create-setup-task-list.ts`),
 * which pre-builds one task-list row per entry — duplicating this sequence by
 * hand at the CLI layer would silently drift the moment a phase is added,
 * renamed, or reordered here.
 *
 * `resume` never takes a `.bak` backup (there is nothing to restore — the
 * interrupted crawl's tmp dir is the source of truth), so unlike
 * `append`/`inventory`/`retryFailed` this sequence has no failure-only
 * recovery phase and no branching: every `resume` call announces exactly
 * these seven phases in this order.
 */
export const RESUME_SETUP_PHASES = [
	'Reconnecting to archive',
	'Loading archive config',
	// Renamed from 'Loading dedupe-cap shape keys' — this phase now covers
	// both the confirmed-capped shape-key read AND the not-yet-capped shape
	// observation replay (`archive.listDedupeCapObservations` /
	// `#preloadDedupeCapObservations`), not just the former.
	'Loading dedupe-cap state',
	'Loading crawl state',
	'Loading resource list',
	'Loading scraped page count',
	'Restoring crawl state',
] as const;
