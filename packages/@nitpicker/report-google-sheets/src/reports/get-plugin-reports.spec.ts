import type { Report } from '@nitpicker/types';

import { describe, it, expect, vi } from 'vitest';

import { getPluginReports } from './get-plugin-reports.js';

describe('getPluginReports', () => {
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
});
