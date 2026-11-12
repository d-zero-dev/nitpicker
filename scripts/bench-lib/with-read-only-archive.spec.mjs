import path from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const managerOpen = vi.fn();
const managerClose = vi.fn();

vi.mock('@nitpicker/query', () => ({
	ArchiveManager: class {
		close(...args) {
			return managerClose(...args);
		}
		open(...args) {
			return managerOpen(...args);
		}
	},
}));

const { withReadOnlyArchive } = await import('./with-read-only-archive.mjs');

describe('withReadOnlyArchive', () => {
	beforeEach(() => {
		managerOpen.mockReset();
		managerClose.mockReset();
	});

	it('opens the resolved path, hands the accessor to the work, and closes it', async () => {
		const accessor = { readOnly: true };
		managerOpen.mockResolvedValue({ archiveId: 'archive-1', accessor });
		managerClose.mockResolvedValue();
		const result = await withReadOnlyArchive('site.nitpicker', async (opened) => {
			expect(opened).toBe(accessor);
			return 'measured';
		});
		expect(result).toBe('measured');
		expect(managerOpen).toHaveBeenCalledWith(path.resolve('site.nitpicker'));
		expect(managerClose).toHaveBeenCalledWith('archive-1');
	});

	it('closes the archive when the work fails', async () => {
		managerOpen.mockResolvedValue({ archiveId: 'archive-1', accessor: {} });
		managerClose.mockResolvedValue();
		await expect(
			withReadOnlyArchive('site.nitpicker', async () => {
				throw new Error('bench failed');
			}),
		).rejects.toThrow('bench failed');
		expect(managerClose).toHaveBeenCalledWith('archive-1');
	});
});
