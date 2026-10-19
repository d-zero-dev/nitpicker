import type { StructuralTechnologySignal } from './types.js';

import { nativeBinding } from './native-binding.js';

/**
 * Matches the license-banner fingerprints (`js-license-comment`, such as
 * Vue's leading `/*! * Vue.js v3…` comment) against the leading bytes of a
 * JS resource, returning the first that occurs. The same definitions
 * {@link import('./match-structural-technology-signals.js').matchStructuralTechnologySignals}
 * applies to HTML; the other fingerprints describe HTML and are not tested.
 * @param script - The resource's leading bytes as fetched. Bytes that are
 *   not valid UTF-8 (a prefix cut inside a character) read as U+FFFD in the
 *   evidence, as `Buffer.prototype.toString('utf8')` decodes them.
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
): StructuralTechnologySignal | null {
	return nativeBinding.matchJsLicenseCommentSignal(script);
}
