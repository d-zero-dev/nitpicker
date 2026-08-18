import type { MockInstance } from 'vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same tactic as @nitpicker/core's worker.spec.ts: the entry runs at module
// scope (top-level await), so each test uses vi.resetModules() + dynamic
// import() for a fresh execution, with parentPort/workerData mocked instead
// of spawning a real thread.

const mockPostMessage = vi.fn();

let mockParentPort: { postMessage: typeof mockPostMessage } | null = {
	postMessage: mockPostMessage,
};
let mockWorkerData: { tmpDir: string; task: 'build' | 'backfills' } = {
	tmpDir: '/tmp/archive-dir',
	task: 'build',
};

vi.mock('node:worker_threads', () => ({
	get parentPort() {
		return mockParentPort;
	},
	get workerData() {
		return mockWorkerData;
	},
}));

const mockClose = vi.fn();
const mockKnexRaw = vi.fn();
const mockConnect = vi.fn();

vi.mock('@nitpicker/crawler', () => ({
	Archive: {
		get connect() {
			return mockConnect;
		},
	},
}));

const mockBuildViewerReadModel = vi.fn();

vi.mock('../build-viewer-read-model.js', () => ({
	buildViewerReadModel: mockBuildViewerReadModel,
}));

const mockBackfillBodyHashFromHtmlBlobs = vi.fn();
const mockBackfillAliasOfId = vi.fn();
const mockBackfillDedupeCapEventId = vi.fn();

vi.mock('../backfill-body-hash-from-html-blobs.js', () => ({
	backfillBodyHashFromHtmlBlobs: mockBackfillBodyHashFromHtmlBlobs,
}));

vi.mock('../backfill-alias-of-id.js', () => ({
	backfillAliasOfId: mockBackfillAliasOfId,
}));

vi.mock('../backfill-dedupe-cap-event-id.js', () => ({
	backfillDedupeCapEventId: mockBackfillDedupeCapEventId,
}));

describe('viewer-read-model-worker-entry', () => {
	let exitSpy: MockInstance<typeof process.exit>;

	beforeEach(() => {
		vi.resetModules();
		mockPostMessage.mockClear();
		mockClose.mockClear().mockResolvedValue();
		mockKnexRaw.mockClear().mockResolvedValue(undefined as never);
		mockConnect.mockReset().mockResolvedValue({
			close: mockClose,
			getKnex: () => ({ raw: mockKnexRaw }),
		});
		mockBuildViewerReadModel.mockReset().mockResolvedValue();
		mockBackfillBodyHashFromHtmlBlobs.mockReset().mockResolvedValue();
		mockBackfillAliasOfId.mockReset().mockResolvedValue();
		mockBackfillDedupeCapEventId.mockReset().mockResolvedValue();
		mockWorkerData = { tmpDir: '/tmp/archive-dir', task: 'build' };
		mockParentPort = { postMessage: mockPostMessage };
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
			// no-op: tests assert via the spy rather than exiting vitest
		}) as never);
	});

	afterEach(async () => {
		// The entry schedules its process.exit(0) via setImmediate; flush one
		// macrotask turn so it fires while the spy is still installed —
		// restoring first would let the deferred call hit the real process.exit.
		await new Promise((resolve) => setImmediate(resolve));
		exitSpy.mockRestore();
	});

	it('opens a writable connection to the workerData tmpDir, builds, closes, and posts done', async () => {
		await import('./viewer-read-model-worker-entry.js');

		expect(mockPostMessage).toHaveBeenCalledWith({ type: 'done' });
		expect(mockConnect).toHaveBeenCalledWith('/tmp/archive-dir', null, {
			readOnly: false,
		});
		expect(mockClose).toHaveBeenCalledOnce();
		// The close must land before the terminal message so the parent's
		// later archive.write() checkpoint never races a dangling handle.
		expect(mockClose.mock.invocationCallOrder[0]!).toBeLessThan(
			mockPostMessage.mock.invocationCallOrder.at(-1)!,
		);
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(0);
		});
	});

	it('relays onPhase and onProgress callbacks as postMessage events', async () => {
		mockBuildViewerReadModel.mockImplementation(
			(
				_accessor: unknown,
				options: {
					onPhase: (phase: string) => void;
					onProgress: (progress: unknown) => void;
				},
			) => {
				options.onPhase('buildingAnchorFacts');
				options.onProgress({ insertedRows: 250, totalRows: 500 });
				return Promise.resolve();
			},
		);

		await import('./viewer-read-model-worker-entry.js');

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'phase',
			phase: 'buildingAnchorFacts',
		});
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'progress',
			progress: { insertedRows: 250, totalRows: 500 },
		});
		expect(mockPostMessage).toHaveBeenCalledWith({ type: 'done' });
	});

	it('posts an error message (and still closes the connection) when the build fails', async () => {
		mockBuildViewerReadModel.mockRejectedValue(new Error('db exploded'));

		await import('./viewer-read-model-worker-entry.js');

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'error',
			message: 'db exploded',
		});
		expect(mockClose).toHaveBeenCalledOnce();
		expect(mockPostMessage).not.toHaveBeenCalledWith({ type: 'done' });
		await vi.waitFor(() => {
			expect(exitSpy).toHaveBeenCalledWith(0);
		});
	});

	it('posts an AggregateError message when both the build AND the close fail (issue #294 code review)', async () => {
		// Regression test: a plain `finally { await accessor.close() }` would
		// let the close failure mask the original build failure. Both must
		// surface, not just whichever one happened to be caught last.
		mockBuildViewerReadModel.mockRejectedValue(new Error('db exploded'));
		mockClose.mockRejectedValue(new Error('close also exploded'));

		await import('./viewer-read-model-worker-entry.js');

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'error',
			message:
				'viewer read model task failed AND closing the worker archive connection also failed.',
		});
		expect(mockPostMessage).not.toHaveBeenCalledWith({ type: 'done' });
	});

	it('posts an error message when the connection itself cannot be opened', async () => {
		mockConnect.mockRejectedValue(new Error('no such directory'));

		await import('./viewer-read-model-worker-entry.js');

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'error',
			message: 'no such directory',
		});
		expect(mockBuildViewerReadModel).not.toHaveBeenCalled();
	});

	it('stringifies non-Error throws', async () => {
		mockBuildViewerReadModel.mockRejectedValue('string error');

		await import('./viewer-read-model-worker-entry.js');

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'error',
			message: 'string error',
		});
	});

	it("runs the three backfills plus the WAL checkpoint for the 'backfills' task, in order", async () => {
		mockWorkerData = { tmpDir: '/tmp/archive-dir', task: 'backfills' };

		await import('./viewer-read-model-worker-entry.js');

		expect(mockBuildViewerReadModel).not.toHaveBeenCalled();
		expect(mockBackfillBodyHashFromHtmlBlobs).toHaveBeenCalledOnce();
		expect(mockBackfillAliasOfId).toHaveBeenCalledOnce();
		expect(mockBackfillDedupeCapEventId).toHaveBeenCalledOnce();
		expect(mockKnexRaw).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE)');
		// alias_of_id's trailing-slash tier depends on body_hash being
		// computed first, and the checkpoint must fold back all three.
		expect(mockBackfillBodyHashFromHtmlBlobs.mock.invocationCallOrder[0]!).toBeLessThan(
			mockBackfillAliasOfId.mock.invocationCallOrder[0]!,
		);
		expect(mockBackfillAliasOfId.mock.invocationCallOrder[0]!).toBeLessThan(
			mockBackfillDedupeCapEventId.mock.invocationCallOrder[0]!,
		);
		expect(mockBackfillDedupeCapEventId.mock.invocationCallOrder[0]!).toBeLessThan(
			mockKnexRaw.mock.invocationCallOrder[0]!,
		);
		expect(mockPostMessage).toHaveBeenCalledWith({ type: 'done' });
	});

	it("posts the backfill phases and relays their progress for the 'backfills' task", async () => {
		mockWorkerData = { tmpDir: '/tmp/archive-dir', task: 'backfills' };
		mockBackfillAliasOfId.mockImplementation(
			(_accessor: unknown, onProgress: (processed: number, total: number) => void) => {
				onProgress(2, 5);
				return Promise.resolve();
			},
		);

		await import('./viewer-read-model-worker-entry.js');

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'phase',
			phase: 'backfillingBodyHash',
		});
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'phase',
			phase: 'backfillingAliasOfId',
		});
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'progress',
			progress: { insertedRows: 2, totalRows: 5 },
		});
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'phase',
			phase: 'backfillingDedupeCapEventId',
		});
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'phase',
			phase: 'checkpointing',
		});
		expect(mockPostMessage).toHaveBeenCalledWith({ type: 'done' });
	});

	it("posts an error message (and still closes the connection) when a 'backfills' step fails", async () => {
		mockWorkerData = { tmpDir: '/tmp/archive-dir', task: 'backfills' };
		mockBackfillBodyHashFromHtmlBlobs.mockRejectedValue(new Error('backfill broke'));

		await import('./viewer-read-model-worker-entry.js');

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: 'error',
			message: 'backfill broke',
		});
		expect(mockClose).toHaveBeenCalledOnce();
		expect(mockPostMessage).not.toHaveBeenCalledWith({ type: 'done' });
	});

	it('throws at module load when parentPort is null (not a worker thread)', async () => {
		mockParentPort = null;
		await expect(import('./viewer-read-model-worker-entry.js')).rejects.toThrow(
			'Use in worker thread',
		);
	});
});
