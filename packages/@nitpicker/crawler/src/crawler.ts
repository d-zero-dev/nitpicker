/**
 * @module @nitpicker/crawler
 *
 * Browser-driven crawl orchestration of Nitpicker (puppeteer / beholder /
 * dealer). The `.nitpicker` archive layer itself — schema, read/write,
 * migration, cache, concat/split, template classification, scope and
 * error-kind helpers — lives in `@nitpicker/archive` and is imported from
 * there directly; this entry point does not re-export it.
 */

// Types + Utils
export * from './utils/types/types.js';
export { DOMEvaluationError } from './utils/error/dom-evaluation-error.js';
export * from './utils/object/clean-object.js';
export { globalLog as log } from './utils/debug.js';

// Core
export {
	DEFAULT_EXCLUDED_EXTERNAL_URLS,
	CrawlerOrchestrator,
} from './crawler-orchestrator.js';
export { RESUME_SETUP_PHASES } from './resume-setup-phases.js';
export { APPEND_SETUP_PHASES } from './append-setup-phases.js';
export { RETRY_FAILED_SETUP_PHASES } from './retry-failed-setup-phases.js';
export { INVENTORY_SETUP_PHASES } from './inventory-setup-phases.js';
export { RECRAWL_SETUP_PHASES } from './recrawl-setup-phases.js';
export { SETUP_RECOVERY_PHASE_LABELS } from './setup-recovery-phase-labels.js';
export { PendingUrlsRemainError } from './pending-urls-remain-error.js';
export { computeAutoRetryBackoffDelayMs } from './compute-auto-retry-backoff-delay.js';
export * from './types.js';
export * from './crawler/types.js';
export { default as NetworkOutageDetector } from './crawler/network-outage-detector.js';
export { default as NetworkGate } from './crawler/network-gate.js';
export type { NetworkProbe } from './crawler/probe-network.js';
export { probeNetwork } from './crawler/probe-network.js';
export { chooseProbeHost } from './crawler/choose-probe-host.js';
export { assertChromeIsInstalled } from './crawler/assert-chrome-installed.js';
export { assertPuppeteerSharedWithBeholder } from './crawler/assert-puppeteer-shared-with-beholder.js';
export { computeFileSha256 } from './utils/compute-file-sha256.js';
export { scanJsResourceForLicenseComment } from './crawler/scan-js-resource-for-license-comment.js';
export type {
	ScanJsResourcesForTechnologySignalsOptions,
	ScanJsResourcesForTechnologySignalsResult,
} from './crawler/scan-js-resources-for-technology-signals.js';
export { scanJsResourcesForTechnologySignals } from './crawler/scan-js-resources-for-technology-signals.js';

// Output-path resolution, needed by CLI commands that produce a NEW
// `.nitpicker` archive from existing ones (`concat` / `split`) rather than
// crawling — same normalization `crawl --output` and `pipeline` already
// apply.
export { resolveOutputPath } from './resolve-output-path.js';
