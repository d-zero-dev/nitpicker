import { describe, expect, it } from 'vitest';

import { SUPPORTED_SELECTOR_GRAMMAR } from './supported-selector-grammar.js';
import { UnsupportedSelectorError } from './unsupported-selector-error.js';

describe('UnsupportedSelectorError', () => {
	it('names the selector and the reason, then lists the grammar', () => {
		const error = new UnsupportedSelectorError('a + b', 'adjacent sibling combinator');
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('UnsupportedSelectorError');
		expect(error.message).toContain('"a + b"');
		expect(error.message).toContain('adjacent sibling combinator');
		expect(error.message).toContain(SUPPORTED_SELECTOR_GRAMMAR);
		expect(error.reason).toBe('adjacent sibling combinator');
		expect(error.reason).not.toContain(SUPPORTED_SELECTOR_GRAMMAR);
	});

	it('keeps the cause', () => {
		const cause = new Error('boom');
		expect(new UnsupportedSelectorError('x', 'y', { cause }).cause).toBe(cause);
	});
});
