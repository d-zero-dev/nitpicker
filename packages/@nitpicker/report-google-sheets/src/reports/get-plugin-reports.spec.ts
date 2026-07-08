import type { Report } from '@nitpicker/types';

import { getViolations } from '@nitpicker/query';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { getPluginReports } from './get-plugin-reports.js';

vi.mock('@nitpicker/query', () => ({
	getViolations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));

describe('getPluginReports', () => {
	beforeEach(() => {
		vi.mocked(getViolations).mockReset();
		vi.mocked(getViolations).mockResolvedValue({ items: [], total: 0 });
	});

	it('returns report when archive has analysis data', async () => {
		const report: Report = {
			name: 'test-plugin',
			violations: [],
		};
		const archive = {
			getData: vi.fn().mockResolvedValue(report),
		};

		const result = await getPluginReports(archive as never);

		expect(archive.getData).toHaveBeenCalledWith('analysis/report');
		expect(result).toEqual([report]);
	});

	it('returns empty array when archive has no analysis data', async () => {
		const archive = {
			getData: vi.fn().mockResolvedValue(null),
		};

		const result = await getPluginReports(archive as never);

		expect(result).toEqual([]);
	});

	it('returns empty array when getData throws', async () => {
		const archive = {
			getData: vi.fn().mockRejectedValue(new Error('not found')),
		};

		const result = await getPluginReports(archive as never);

		expect(result).toEqual([]);
	});

	it('adds SQL-backed violations in chunks', async () => {
		vi.mocked(getViolations)
			.mockResolvedValueOnce({
				total: 2,
				items: [
					{
						url: 'https://example.com/a',
						validator: 'axe',
						severity: 'error',
						rule: 'color-contrast',
						message: 'contrast',
						code: '<div>',
					},
				],
			})
			.mockResolvedValueOnce({
				total: 2,
				items: [
					{
						url: 'https://example.com/b',
						validator: 'textlint',
						severity: 'warning',
						rule: 'ja-no-weak-phrase',
						message: 'weak phrase',
						code: '',
					},
				],
			});
		const archive = {
			getData: vi.fn().mockResolvedValue(null),
		};

		const result = await getPluginReports(archive as never);

		expect(result).toEqual([
			{
				name: 'violations',
				violations: [
					expect.objectContaining({ url: 'https://example.com/a' }),
					expect.objectContaining({ url: 'https://example.com/b' }),
				],
			},
		]);
		expect(vi.mocked(getViolations).mock.calls[0]?.[1]).toEqual({
			limit: 5000,
			offset: 0,
		});
		expect(vi.mocked(getViolations).mock.calls[1]?.[1]).toEqual({
			limit: 5000,
			offset: 1,
		});
	});
});
