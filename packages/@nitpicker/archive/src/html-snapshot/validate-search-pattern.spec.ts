import { describe, it, expect } from 'vitest';

import { validateSearchPattern } from './validate-search-pattern.js';

describe('validateSearchPattern', () => {
	it('passes the native verdict and error through', () => {
		const pattern = {
			source: 'a*',
			literal: false,
			ignoreCase: false,
			multiLine: false,
			dotAll: false,
		};
		expect(validateSearchPattern(pattern)).toBe(true);
		expect(() => validateSearchPattern({ ...pattern, source: '(?=a)' })).toThrow(
			expect.objectContaining({ code: 'InvalidArg' }),
		);
	});
});
