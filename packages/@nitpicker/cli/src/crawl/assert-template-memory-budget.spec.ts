import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertTemplateMemoryBudget } from './assert-template-memory-budget.js';

describe('assertTemplateMemoryBudget', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('accepts no budget', () => {
		expect(() => assertTemplateMemoryBudget()).not.toThrow();
	});

	it('accepts a valid flag, zero included', () => {
		expect(() => assertTemplateMemoryBudget(512)).not.toThrow();
		expect(() => assertTemplateMemoryBudget(0)).not.toThrow();
	});

	it('rejects a negative flag before any work starts', () => {
		expect(() => assertTemplateMemoryBudget(-1)).toThrow(
			'Invalid template memory budget (--template-memory-budget -1)',
		);
	});

	it('rejects an invalid NITPICKER_TEMPLATE_MEMORY_BUDGET when no flag is given', () => {
		vi.stubEnv('NITPICKER_TEMPLATE_MEMORY_BUDGET', 'lots');

		expect(() => assertTemplateMemoryBudget()).toThrow(
			'Invalid template memory budget (NITPICKER_TEMPLATE_MEMORY_BUDGET="lots")',
		);
	});

	it('ignores an invalid variable when the flag overrides it', () => {
		vi.stubEnv('NITPICKER_TEMPLATE_MEMORY_BUDGET', 'lots');

		expect(() => assertTemplateMemoryBudget(64)).not.toThrow();
	});
});
