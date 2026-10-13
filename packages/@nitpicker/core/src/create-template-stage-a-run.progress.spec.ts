import type {
	NativeStageAProgress,
	NativeTemplateStageARun,
	StageAProgress,
} from './types.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTemplateStageARun } from './create-template-stage-a-run.js';

/**
 * A stand-in for the addon's run whose calls settle and whose progress
 * events arrive when the test says, so the orderings the real addon leaves
 * to thread scheduling can be pinned.
 */
class FakeRun implements NativeTemplateStageARun {
	cancelled = false;
	readonly calls: {
		resolve: (sent: number) => void;
		reject: (error: unknown) => void;
	}[] = [];
	readonly emit: (event: NativeStageAProgress) => void;

	constructor(onProgress: (event: NativeStageAProgress) => void) {
		this.emit = onProgress;
	}

	cancel(): void {
		this.cancelled = true;
	}
	finishPages(): Promise<number> {
		return this.#call();
	}
	needsAssignment(): boolean {
		return false;
	}
	pageMask(): Uint8Array {
		return new Uint8Array(0);
	}
	pushAssignmentPages(): Promise<number> {
		return this.#call();
	}
	pushPages(): Promise<number> {
		return this.#call();
	}
	takeOutput(): never {
		throw new Error('not used');
	}
	#call(): Promise<number> {
		return new Promise((resolve, reject) => this.calls.push({ resolve, reject }));
	}
}

const fake = vi.hoisted(() => ({ run: undefined as FakeRun | undefined }));

vi.mock('./native-binding.js', () => ({
	nativeBinding: {
		TemplateStageARun: class {
			constructor(
				_blockKeys: readonly string[],
				_blockOfPage: Uint32Array,
				_streaming: boolean,
				onProgress: (event: NativeStageAProgress) => void,
			) {
				fake.run = new FakeRun(onProgress);

				return fake.run;
			}
		},
	},
}));

const BLOCK_EVENT: NativeStageAProgress = {
	phase: 'pass1-block-complete',
	blockKey: 'path:a',
	blocksProcessed: 1,
	totalBlocks: 1,
};

/**
 * Lets pending promise callbacks run.
 */
function flush(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

/**
 * A run over the fake, recording what reaches `onProgress`.
 * @param onProgress
 */
function start(onProgress: (event: StageAProgress) => void = () => {}) {
	const run = createTemplateStageARun({
		blockKeys: ['path:a'],
		blockOfPage: Uint32Array.of(0),
		streaming: true,
		onProgress,
	});
	return { run, native: fake.run! };
}

describe('createTemplateStageARun progress delivery', () => {
	beforeEach(() => {
		fake.run = undefined;
	});

	it('waits for events that arrive after the call resolved', async () => {
		const events: StageAProgress[] = [];
		const { run, native } = start((event) => events.push(event));
		let settled = false;
		const call = run.pushPages([]).then(() => {
			settled = true;
		});
		native.calls[0]!.resolve(1);
		await flush();
		expect(settled).toBe(false);
		native.emit(BLOCK_EVENT);
		await call;
		expect(settled).toBe(true);
		expect(events).toHaveLength(1);
	});

	it('resolves at once when the events arrived before the call resolved', async () => {
		const events: StageAProgress[] = [];
		const { run, native } = start((event) => events.push(event));
		const call = run.pushPages([]);
		native.emit(BLOCK_EVENT);
		native.calls[0]!.resolve(1);
		await call;
		expect(events).toHaveLength(1);
	});

	it('rejects with the error onProgress threw when the cancelled call rejects', async () => {
		const failure = new Error('progress sink failed');
		const { run, native } = start(() => {
			throw failure;
		});
		const call = run.pushPages([]);
		native.emit(BLOCK_EVENT);
		expect(native.cancelled).toBe(true);
		native.calls[0]!.reject(new Error('template classification was cancelled'));
		await expect(call).rejects.toBe(failure);
		await expect(run.finishPages()).rejects.toBe(failure);
		expect(native.calls).toHaveLength(1);
	});

	it('fails the run on a rejected call and drops the events that call sent', async () => {
		const events: StageAProgress[] = [];
		const { run, native } = start((event) => events.push(event));
		const error = new Error('received page 2 of 1');
		const call = run.pushPages([]);
		native.calls[0]!.reject(error);
		await expect(call).rejects.toBe(error);
		native.emit(BLOCK_EVENT);
		expect(events).toEqual([]);
		await expect(run.pushPages([])).rejects.toBe(error);
		await expect(run.takeOutput()).rejects.toBe(error);
		expect(native.calls).toHaveLength(1);
	});

	it('leaves the run usable after a call refused for overlapping', async () => {
		const { run, native } = start();
		const busy = new Error('a TemplateStageARun call is still running');
		const pushPages = vi.spyOn(native, 'pushPages').mockImplementationOnce(() => {
			throw busy;
		});
		await expect(run.pushPages([])).rejects.toBe(busy);
		pushPages.mockRestore();
		const call = run.finishPages();
		native.calls[0]!.resolve(0);
		await expect(call).resolves.toBeUndefined();
	});

	it('stops waiting for events once cancelled', async () => {
		const { run, native } = start();
		const call = run.pushPages([]);
		native.calls[0]!.resolve(2);
		await flush();
		run.cancel();
		await expect(call).resolves.toBeUndefined();
		expect(native.cancelled).toBe(true);
	});
});
