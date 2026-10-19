import type { TechnologySignalPartial } from './types.js';

import { matchJsLicenseCommentSignal as matchJsLicenseCommentSignalNative } from '@nitpicker/core/match-js-license-comment-signal';

/**
 * Tests a JS resource's leading bytes against the structural fingerprint
 * list's `js-license-comment` definitions (such as Vue's leading license
 * banner), returning the first that matches. The same definitions
 * `matchStructuralTechnologySignals` applies to page HTML; the list lives
 * in `@nitpicker/core`'s `crates/nitpicker_tech_detect`, and the crawler
 * reaches it through this function because it does not import the addon
 * directly.
 * @param script - The resource's leading bytes as fetched (a byte-capped
 *   prefix, so possibly cut inside a character — such bytes read as U+FFFD,
 *   as `Buffer.prototype.toString('utf8')` decodes them).
 * @returns The first matching signal, or `null` when none matches.
 * @example
 * ```ts
 * matchJsLicenseCommentSignal(Buffer.from('/*!\n * Vue.js v3.4.0\n *\/'));
 * // { technology: 'Vue', signalType: 'js-license-comment',
 * //   evidence: '/*!\n * Vue.js v3', weight: 55, category: 'JavaScript frameworks' }
 * ```
 */
export function matchJsLicenseCommentSignal(
	script: Uint8Array,
): TechnologySignalPartial | null {
	return matchJsLicenseCommentSignalNative(script);
}
