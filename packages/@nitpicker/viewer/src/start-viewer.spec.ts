import { afterEach, describe, it, expect, vi } from 'vitest';

const { mockCreateArchiveContext, mockServerClose, mockCloseAll } = vi.hoisted(() => ({
	mockCreateArchiveContext: vi.fn(),
	mockServerClose: vi.fn(),
	mockCloseAll: vi.fn().mockResolvedValue(),
}));

vi.mock('@hono/node-server', () => ({
	serve: vi.fn(() => ({ close: mockServerClose })),
}));

vi.mock('@nitpicker/query', () => ({
	isViewerReadModelCurrent: vi.fn().mockResolvedValue(true),
}));

vi.mock('./archive-context.js', () => ({
	createArchiveContext: mockCreateArchiveContext,
}));

vi.mock('./create-app.js', () => ({
	createApp: vi.fn(() => ({ fetch: vi.fn() })),
}));

vi.mock('./find-free-port.js', () => ({
	findFreePort: vi.fn().mockResolvedValue(4324),
}));

vi.mock('./open-browser.js', () => ({
	openBrowser: vi.fn(),
}));

import { startViewer } from './start-viewer.js';

describe('startViewer', () => {
	afterEach(() => {
		vi.clearAllMocks();
		process.removeAllListeners('SIGINT');
		process.removeAllListeners('SIGTERM');
	});

	it('forwards onExtractProgress to createArchiveContext (issue #294)', async () => {
		mockCreateArchiveContext.mockResolvedValue({
			manager: { get: vi.fn(), closeAll: mockCloseAll },
			archiveId: 'archive_1',
			filePath: '/tmp/site.nitpicker',
			mode: 'stub',
			crawlerLockHolder: null,
		});
		const onExtractProgress = vi.fn();

		const startedPromise = startViewer({
			filePath: '/tmp/site.nitpicker',
			open: false,
			onExtractProgress,
		});
		// `startViewer` registers its SIGINT handler only after `await
		// createArchiveContext(...)` resolves — wait for that registration
		// before emitting, or the signal fires before anything is listening.
		await vi.waitFor(() => {
			expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);
		});
		process.emit('SIGINT');
		await startedPromise;

		expect(mockCreateArchiveContext).toHaveBeenCalledWith(
			'/tmp/site.nitpicker',
			onExtractProgress,
		);
	});
});
