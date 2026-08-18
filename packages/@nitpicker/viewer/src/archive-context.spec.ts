import { ArchiveManager } from '@nitpicker/query';
import { afterEach, describe, it, expect, vi } from 'vitest';

const mockOpen = vi.fn();

vi.mock('@nitpicker/query', () => ({
	ArchiveManager: vi.fn().mockImplementation(function (this: { open: typeof mockOpen }) {
		this.open = mockOpen;
	}),
}));

import { createArchiveContext } from './archive-context.js';

describe('createArchiveContext', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('forwards onExtractProgress to the ArchiveManager constructor (issue #294)', async () => {
		mockOpen.mockResolvedValue({
			archiveId: 'archive_1',
			mode: 'archive',
			crawlerLockHolder: null,
		});
		const onExtractProgress = vi.fn();

		await createArchiveContext('/tmp/site.nitpicker', onExtractProgress);

		expect(ArchiveManager).toHaveBeenCalledWith({ onExtractProgress });
	});

	it('omits onExtractProgress when not given', async () => {
		mockOpen.mockResolvedValue({
			archiveId: 'archive_1',
			mode: 'archive',
			crawlerLockHolder: null,
		});

		await createArchiveContext('/tmp/site.nitpicker');

		expect(ArchiveManager).toHaveBeenCalledWith({ onExtractProgress: undefined });
	});

	it('returns the context built from the opened archive', async () => {
		mockOpen.mockResolvedValue({
			archiveId: 'archive_1',
			mode: 'stub',
			crawlerLockHolder: null,
		});

		const context = await createArchiveContext('/tmp/stub-dir');

		expect(context.archiveId).toBe('archive_1');
		expect(context.mode).toBe('stub');
		expect(context.filePath).toBe('/tmp/stub-dir');
	});
});
