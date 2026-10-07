import { SUPPORTED_SELECTOR_GRAMMAR } from './supported-selector-grammar.js';

/**
 * Thrown when a selector is syntactically invalid or uses a construct
 * `match-selector` does not evaluate. The message names the offending
 * construct and lists the supported grammar.
 * @example
 * throw new UnsupportedSelectorError('a + b', 'adjacent sibling combinator (+)');
 */
export class UnsupportedSelectorError extends Error {
	/** Why the selector was rejected, without the grammar listing. */
	readonly reason: string;

	/**
	 * @param selector - The selector as the caller wrote it.
	 * @param reason - Why it was rejected.
	 * @param options - Standard error options (`cause`).
	 */
	constructor(selector: string, reason: string, options?: ErrorOptions) {
		super(
			`Unsupported or invalid selector "${selector}": ${reason}\n${SUPPORTED_SELECTOR_GRAMMAR}`,
			options,
		);
		this.name = 'UnsupportedSelectorError';
		this.reason = reason;
	}
}
