import { APPEND_RETRY_FAILED_COMMON_SETUP_PHASES } from './append-retry-failed-common-setup-phases.js';

/**
 * Ordered `SetupProgressCallbacks.onPhase` labels `CrawlerOrchestrator.append`
 * announces, in call order, before its `initializedCallback` fires. Single
 * source of truth for both the `onPhase` call sites in
 * `crawler-orchestrator.ts` and the CLI's setup task list (`create-setup-task-list.ts`),
 * which pre-builds one task-list row per entry — duplicating this sequence by
 * hand at the CLI layer would silently drift the moment a phase is added,
 * renamed, or reordered here. Shares its prefix/suffix with
 * `RETRY_FAILED_SETUP_PHASES` via `APPEND_RETRY_FAILED_COMMON_SETUP_PHASES` —
 * `'Repromoting external pages'` is the one step unique to `append()`.
 *
 * Linear on the success path (no branching before `initializedCallback`). On
 * failure — anywhere from `archive.updateConfig` through the crawl itself —
 * a `SETUP_RECOVERY_PHASE_LABELS` entry (`'Restoring archive from backup'`)
 * is announced instead of continuing this sequence.
 */
export const APPEND_SETUP_PHASES = [
	...APPEND_RETRY_FAILED_COMMON_SETUP_PHASES.prefix,
	'Repromoting external pages',
	...APPEND_RETRY_FAILED_COMMON_SETUP_PHASES.suffix,
] as const;
