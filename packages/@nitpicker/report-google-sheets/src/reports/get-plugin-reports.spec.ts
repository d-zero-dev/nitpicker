import type { Report } from '@nitpicker/types';

import { describe, it, expect, vi } from 'vitest';

import { getPluginReports } from './get-plugin-reports.js';

describe('getPluginReports', () => {
	it('returns report when archive has analysis data', async () => {
		const report: Report = {
			name: 'test-plugin',
		};
		const accessor = {
			getData: vi.fn().mockResolvedValue(report),
		};

		const result = await getPluginReports(accessor as never);

		expect(accessor.getData).toHaveBeenCalledWith('analysis/report');
		expect(result).toEqual([report]);
	});

	it('returns empty array when archive has no analysis data', async () => {
		const accessor = {
			getData: vi.fn().mockResolvedValue(null),
		};

		const result = await getPluginReports(accessor as never);

		expect(result).toEqual([]);
	});

	it('returns empty array when getData throws', async () => {
		const accessor = {
			getData: vi.fn().mockRejectedValue(new Error('not found')),
		};

		const result = await getPluginReports(accessor as never);

		expect(result).toEqual([]);
	});

	it('does not load violations — the Violations sheet reads them directly via getViolations', async () => {
		const accessor = {
			getData: vi.fn().mockResolvedValue(null),
		};

		const result = await getPluginReports(accessor as never);

		expect(result).toEqual([]);
	});
});
