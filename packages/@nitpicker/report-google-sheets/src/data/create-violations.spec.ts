import { streamAllViolations } from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellValue } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';
import { oneChunk } from '../test-helpers/one-chunk.js';

import { createViolations } from './create-violations.js';

vi.mock('@nitpicker/query', () => ({
	streamAllViolations: vi.fn(),
}));

/**
 * Builds a fake accessor whose `getKnex()().count()` resolves to a fixed
 * `analysis_violations` row count, for `estimateRowCount()` tests.
 * @param violationCount - The `COUNT(*)` value to return.
 */
function makeAccessor(violationCount: number) {
	return {
		getKnex: () => () => ({
			count: () => [{ count: violationCount }],
		}),
	} as never;
}

describe('createViolations', () => {
	beforeEach(() => {
		vi.mocked(streamAllViolations).mockReset();
	});

	it('returns sheet config with name "Violations", no read-model dependency', () => {
		const setting = createViolations([], makeAccessor(0));
		expect(setting.name).toBe('Violations');
		expect(setting.requiresReadModel).toBeFalsy();
	});

	it('returns correct headers', () => {
		const setting = createViolations([], makeAccessor(0));
		const headers = setting.createHeaders();
		expect(headers).toEqual(['Validator', 'Severity', 'Rule', 'Code', 'Message', 'URL']);
	});

	it('estimates the row count via an analysis_violations COUNT(*)', async () => {
		const setting = createViolations([], makeAccessor(42));
		await expect(setting.estimateRowCount()).resolves.toBe(42);
	});

	it('streams rows without holding the full result in memory (no lazy thunks either)', async () => {
		vi.mocked(streamAllViolations).mockReturnValue(
			oneChunk([
				{
					validator: 'axe',
					severity: 'serious',
					rule: 'color-contrast',
					code: 'color-contrast',
					message: 'Elements must have sufficient color contrast',
					url: 'https://example.com/a',
				},
				{
					validator: 'markuplint',
					severity: 'warning',
					rule: 'rule-2',
					code: 'code-2',
					message: 'msg-2',
					url: 'https://example.com/b',
				},
			]),
		);

		const setting = createViolations([], makeAccessor(2));
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});

		expect(mock.rows).toHaveLength(2);
		assertNoLazyCells(mock.rows);
		expect(cellValue(mock.rows[0]![0]!)).toBe('axe');
		expect(cellValue(mock.rows[1]![0]!)).toBe('markuplint');
		expect(mock.flushCount).toBe(1);
	});

	it('maps every column to the documented field', async () => {
		vi.mocked(streamAllViolations).mockReturnValue(
			oneChunk([
				{
					validator: 'axe',
					severity: 'serious',
					rule: 'color-contrast',
					code: '<div>',
					message: 'Elements must have sufficient color contrast',
					url: 'https://example.com/',
				},
			]),
		);
		const setting = createViolations([], makeAccessor(1));
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});

		const row = mock.rows[0]!;
		expect(cellValue(row[0]!)).toBe('axe');
		expect(cellValue(row[1]!)).toBe('serious');
		expect(cellValue(row[2]!)).toBe('color-contrast');
		expect(cellValue(row[3]!)).toBe('<div>');
		expect(cellValue(row[4]!)).toBe('Elements must have sufficient color contrast');
		expect(cellValue(row[5]!)).toBe('https://example.com/');
	});

	it('returns no rows when there are no violations', async () => {
		vi.mocked(streamAllViolations).mockReturnValue(oneChunk([]));
		const setting = createViolations([], makeAccessor(0));
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});
		expect(mock.rows).toHaveLength(0);
	});

	it('stops sending rows once maxRows is reached', async () => {
		vi.mocked(streamAllViolations).mockReturnValue(
			oneChunk([
				{
					validator: 'axe',
					severity: 'serious',
					rule: 'rule-1',
					code: 'code-1',
					message: 'msg-1',
					url: 'https://example.com/a',
				},
				{
					validator: 'axe',
					severity: 'minor',
					rule: 'rule-2',
					code: 'code-2',
					message: 'msg-2',
					url: 'https://example.com/b',
				},
			]),
		);
		const setting = createViolations([], makeAccessor(2));
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: 1,
			estimatedTotal: 2,
			onProgress: () => {},
		});
		expect(mock.rows).toHaveLength(1);
	});

	it('reports onProgress against ctx.estimatedTotal, not maxRows (issue: misleading progress denominator)', async () => {
		vi.mocked(streamAllViolations).mockReturnValue(
			oneChunk([
				{
					validator: 'axe',
					severity: 'serious',
					rule: 'rule-1',
					code: 'code-1',
					message: 'msg-1',
					url: 'https://example.com/a',
				},
			]),
		);
		const setting = createViolations([], makeAccessor(1));
		const mock = createMockSheet();
		const onProgress = vi.fn();
		await setting.run({
			sheet: mock.sheet,
			maxRows: 1_000_000, // far larger than estimatedTotal — must not leak into `total`
			estimatedTotal: 1,
			onProgress,
		});
		expect(onProgress).toHaveBeenCalledWith(1, 1);
	});
});
