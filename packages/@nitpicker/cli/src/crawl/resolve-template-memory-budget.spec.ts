import { describe, it, expect } from 'vitest';

import { resolveTemplateMemoryBudget } from './resolve-template-memory-budget.js';

describe('resolveTemplateMemoryBudget', () => {
	it('is undefined, the core default, when neither the flag nor the variable is given', () => {
		expect(resolveTemplateMemoryBudget({})).toBeUndefined();
	});

	it('converts the flag from MiB to bytes', () => {
		expect(resolveTemplateMemoryBudget({ flag: 512 })).toBe(536_870_912);
	});

	it('converts the variable from MiB to bytes, fractions allowed', () => {
		expect(resolveTemplateMemoryBudget({ env: '1.5' })).toBe(1_572_864);
	});

	it('prefers the flag over the variable', () => {
		expect(resolveTemplateMemoryBudget({ flag: 1, env: '64' })).toBe(1_048_576);
	});

	it('treats an empty or blank variable as not given', () => {
		expect(resolveTemplateMemoryBudget({ env: '' })).toBeUndefined();
		expect(resolveTemplateMemoryBudget({ env: '  ' })).toBeUndefined();
	});

	it('accepts zero, which samples every block', () => {
		expect(resolveTemplateMemoryBudget({ flag: 0 })).toBe(0);
		expect(resolveTemplateMemoryBudget({ env: '0' })).toBe(0);
	});

	it('rejects a negative flag, naming it', () => {
		expect(() => resolveTemplateMemoryBudget({ flag: -1 })).toThrow(
			'Invalid template memory budget (--template-memory-budget -1): expected a non-negative number of MiB',
		);
	});

	it('rejects a variable that is not a number, naming it', () => {
		expect(() => resolveTemplateMemoryBudget({ env: 'lots' })).toThrow(
			'Invalid template memory budget (NITPICKER_TEMPLATE_MEMORY_BUDGET="lots"): expected a non-negative number of MiB',
		);
	});

	it('rejects Infinity', () => {
		expect(() => resolveTemplateMemoryBudget({ env: 'Infinity' })).toThrow(
			'expected a non-negative number of MiB',
		);
	});
});
