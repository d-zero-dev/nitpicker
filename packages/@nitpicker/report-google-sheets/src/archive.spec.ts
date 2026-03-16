import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const mockOpen = vi.fn();
const mockClose = vi.fn();

vi.mock('@nitpicker/crawler', () => ({
	Archive: {
		open: mockOpen,
	},
}));

vi.mock('./debug.js', () => ({
	archiveLog: vi.fn(),
}));

describe('getArchive', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockOpen.mockResolvedValue({ close: mockClose });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('archive と removeSignalHandlers を含むオブジェクトを返す', async () => {
		const { getArchive } = await import('./archive.js');
		const handle = await getArchive('/tmp/test.nitpicker');

		expect(handle).toHaveProperty('archive');
		expect(handle).toHaveProperty('removeSignalHandlers');
		expect(typeof handle.removeSignalHandlers).toBe('function');
	});

	it('シグナルリスナーを登録する', async () => {
		const { getArchive } = await import('./archive.js');
		const before = process.listenerCount('SIGINT');

		await getArchive('/tmp/test.nitpicker');

		expect(process.listenerCount('SIGINT')).toBe(before + 1);
		expect(process.listenerCount('SIGHUP')).toBeGreaterThan(0);
		expect(process.listenerCount('SIGABRT')).toBeGreaterThan(0);
	});

	it('removeSignalHandlers を呼ぶとシグナルリスナーが解除される', async () => {
		const { getArchive } = await import('./archive.js');
		const before = process.listenerCount('SIGINT');

		const { removeSignalHandlers } = await getArchive('/tmp/test.nitpicker');
		removeSignalHandlers();

		expect(process.listenerCount('SIGINT')).toBe(before);
	});

	it('複数回呼び出してもリスナーが蓄積しない（removeSignalHandlers で解除した場合）', async () => {
		const { getArchive } = await import('./archive.js');
		const before = process.listenerCount('SIGINT');

		const handle1 = await getArchive('/tmp/test1.nitpicker');
		handle1.removeSignalHandlers();

		const handle2 = await getArchive('/tmp/test2.nitpicker');
		handle2.removeSignalHandlers();

		const handle3 = await getArchive('/tmp/test3.nitpicker');
		handle3.removeSignalHandlers();

		expect(process.listenerCount('SIGINT')).toBe(before);
	});
});
