import type {
	NativeTemplateClassificationOutput,
	NativeTemplateClassificationProgress,
	NativeTemplateClassificationRun,
	TemplateClassificationProgress,
} from './types.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTemplateClassificationRun } from './create-template-classification-run.js';

const EMPTY_OUTPUT: NativeTemplateClassificationOutput = {
	keys: [],
	keyOfPage: new Uint32Array(0),
	reasons: [],
	sampledBlocks: [],
};

/**
 * A stand-in for the addon's run whose calls settle and whose progress
 * events arrive when the test says, so the orderings the real addon leaves
 * to thread scheduling can be pinned.
 */
class FakeRun implements NativeTemplateClassificationRun {
	cancelled = false;
	/** What `takeOutput` hands over. */
	output: NativeTemplateClassificationOutput = EMPTY_OUTPUT;
	readonly calls: {
		resolve: (sent: number) => void;
		reject: (error: unknown) => void;
	}[] = [];
	readonly emit: (event: NativeTemplateClassificationProgress) => void;

	constructor(onProgress: (event: NativeTemplateClassificationProgress) => void) {
		this.emit = onProgress;
	}

	block(): Promise<number> {
		return this.#call();
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
	pushSignals(): void {}
	async takeOutput() {
		const sent = await this.#call();
		return { output: this.output, sent };
	}
	#call(): Promise<number> {
		return new Promise((resolve, reject) => this.calls.push({ resolve, reject }));
	}
}

const fake = vi.hoisted(() => ({ run: undefined as FakeRun | undefined }));

vi.mock('./native-binding.js', () => ({
	nativeBinding: {
		TemplateClassificationRun: class {
			constructor(onProgress: (event: NativeTemplateClassificationProgress) => void) {
				fake.run = new FakeRun(onProgress);

				return fake.run;
			}
		},
	},
}));

const BLOCK_EVENT: NativeTemplateClassificationProgress = {
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
function start(onProgress: (event: TemplateClassificationProgress) => void = () => {}) {
	const run = createTemplateClassificationRun({ onProgress });
	return { run, native: fake.run! };
}

describe('createTemplateClassificationRun progress delivery', () => {
	beforeEach(() => {
		fake.run = undefined;
	});

	it('waits for events that arrive after the call resolved', async () => {
		const events: TemplateClassificationProgress[] = [];
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
		const events: TemplateClassificationProgress[] = [];
		const { run, native } = start((event) => events.push(event));
		const call = run.pushPages([]);
		native.emit(BLOCK_EVENT);
		native.calls[0]!.resolve(1);
		await call;
		expect(events).toHaveLength(1);
	});

	it('waits for the merge event before handing over the output', async () => {
		const events: TemplateClassificationProgress[] = [];
		const { run, native } = start((event) => events.push(event));
		let settled = false;
		const call = run.takeOutput().then((output) => {
			settled = true;
			return output;
		});
		await flush();
		native.calls[0]!.resolve(1);
		await flush();
		expect(settled).toBe(false);
		native.emit({ phase: 'stage-b-start', unitCount: 3 });
		await expect(call).resolves.toEqual({
			keys: [],
			keyOfPage: new Uint32Array(0),
			reasons: new Map(),
			sampledBlocks: [],
		});
		expect(events).toEqual([{ phase: 'stage-b-start', unitCount: 3 }]);
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

	it('delivers a pass1b-assign event with both counts', async () => {
		const events: TemplateClassificationProgress[] = [];
		const { run, native } = start((event) => events.push(event));
		const call = run.pushAssignmentPages([]);
		native.emit({ phase: 'pass1b-assign', pagesAssigned: 1000, pagesToAssign: 19_900 });
		native.calls[0]!.resolve(1);
		await call;
		expect(events).toEqual([
			{ phase: 'pass1b-assign', pagesAssigned: 1000, pagesToAssign: 19_900 },
		]);
	});

	it('delivers a block-sampled event with the block, its size and the budget', async () => {
		const events: TemplateClassificationProgress[] = [];
		const { run, native } = start((event) => events.push(event));
		const call = run.block();
		native.emit({
			phase: 'block-sampled',
			blockKey: 'path:a',
			pageCount: 30_000,
			pairBytes: 3_599_940_000,
			budget: 2_147_483_648,
			reason: 'table-over-budget',
		});
		native.calls[0]!.resolve(1);
		await call;
		expect(events).toEqual([
			{
				phase: 'block-sampled',
				blockKey: 'path:a',
				pageCount: 30_000,
				pairBytes: 3_599_940_000,
				budget: 2_147_483_648,
				reason: 'table-over-budget',
			},
		]);
	});

	it('fails the run when a block-sampled event lacks the budget', async () => {
		const { run, native } = start();
		const call = run.block();
		native.emit({
			phase: 'block-sampled',
			blockKey: 'path:a',
			pageCount: 3,
			pairBytes: 24,
		});
		native.calls[0]!.reject(new Error('template classification was cancelled'));
		await expect(call).rejects.toThrow(
			'template classification progress phase "block-sampled" is missing "budget"',
		);
	});

	it('fails the run when a block-sampled event names an unknown reason', async () => {
		const { run, native } = start();
		const call = run.block();
		native.emit({
			phase: 'block-sampled',
			blockKey: 'path:a',
			pageCount: 3,
			pairBytes: 24,
			budget: 8,
			reason: 'because',
		});
		native.calls[0]!.reject(new Error('template classification was cancelled'));
		await expect(call).rejects.toThrow(
			'unknown template classification sample reason "because"',
		);
	});

	it('fails the output on a sampled block with an unknown reason', async () => {
		const { run, native } = start();
		native.output = {
			...EMPTY_OUTPUT,
			sampledBlocks: [
				{ blockKey: 'path:a', pageCount: 3, pairBytes: 24, reason: 'because' },
			],
		};
		const call = run.takeOutput();
		native.calls[0]!.resolve(0);
		await expect(call).rejects.toThrow(
			'unknown template classification sample reason "because"',
		);
	});

	it('hands over the blocks the addon sampled with the output', async () => {
		const { run, native } = start();
		native.output = {
			...EMPTY_OUTPUT,
			sampledBlocks: [
				{ blockKey: 'path:a', pageCount: 3, pairBytes: 24, reason: 'pages-over-limit' },
			],
		};
		const call = run.takeOutput();
		native.calls[0]!.resolve(0);
		const { sampledBlocks } = await call;
		expect(sampledBlocks).toEqual([
			{ blockKey: 'path:a', pageCount: 3, pairBytes: 24, reason: 'pages-over-limit' },
		]);
	});

	it('fails the run with the error toProgress threw for an unknown phase', async () => {
		const { run, native } = start();
		const call = run.pushPages([]);
		native.emit({ phase: 'pass9-unknown' });
		expect(native.cancelled).toBe(true);
		native.calls[0]!.reject(new Error('template classification was cancelled'));
		await expect(call).rejects.toThrow(
			'unknown template classification progress phase "pass9-unknown"',
		);
		await expect(run.finishPages()).rejects.toThrow(
			'unknown template classification progress phase "pass9-unknown"',
		);
		expect(native.calls).toHaveLength(1);
	});

	it('fails the run when an event lacks a field its phase needs', async () => {
		const { run, native } = start();
		const call = run.pushPages([]);
		native.emit({ phase: 'stage-b-start' });
		native.calls[0]!.reject(new Error('template classification was cancelled'));
		await expect(call).rejects.toThrow(
			'template classification progress phase "stage-b-start" is missing "unitCount"',
		);
	});

	it('fails the output on a landmark of an unknown type', async () => {
		const { run, native } = start();
		native.output = {
			keys: ['k'],
			keyOfPage: new Uint32Array([0]),
			reasons: [
				{
					clusterKey: 'k',
					memberCount: 1,
					blocking: [],
					structuralCoreTokens: [],
					landmarks: [
						{
							type: 'main',
							presenceRate: 1,
							chromeRate: 1,
							shellTokens: [],
							memberCountWithInstance: 1,
						},
					],
					siblingClusterKeys: [],
				},
			],
		};
		const call = run.takeOutput();
		native.calls[0]!.resolve(0);
		await expect(call).rejects.toThrow(
			'unknown template classification landmark type "main"',
		);
	});

	it('fails the output on a landmark type listed twice in one reason', async () => {
		const { run, native } = start();
		const nav = {
			type: 'nav',
			presenceRate: 1,
			chromeRate: 1,
			shellTokens: [],
			memberCountWithInstance: 1,
		};
		native.output = {
			keys: ['k'],
			keyOfPage: new Uint32Array([0]),
			reasons: [
				{
					clusterKey: 'k',
					memberCount: 1,
					blocking: [],
					structuralCoreTokens: [],
					landmarks: [nav, nav],
					siblingClusterKeys: [],
				},
			],
		};
		const call = run.takeOutput();
		native.calls[0]!.resolve(0);
		await expect(call).rejects.toThrow(
			'template classification reason of "k" lists landmark type "nav" twice',
		);
	});

	it('fails the output on a blocking reason of an unknown kind', async () => {
		const { run, native } = start();
		native.output = {
			keys: ['k'],
			keyOfPage: new Uint32Array([0]),
			reasons: [
				{
					clusterKey: 'k',
					memberCount: 1,
					blocking: [{ blockKey: 'b', kind: 'mystery' }],
					structuralCoreTokens: [],
					landmarks: [],
					siblingClusterKeys: [],
				},
			],
		};
		const call = run.takeOutput();
		native.calls[0]!.resolve(0);
		await expect(call).rejects.toThrow(
			'unknown template classification blocking reason kind "mystery"',
		);
	});

	it('fails the output on a blocking reason lacking the field its kind needs', async () => {
		const { run, native } = start();
		native.output = {
			keys: ['k'],
			keyOfPage: new Uint32Array([0]),
			reasons: [
				{
					clusterKey: 'k',
					memberCount: 1,
					blocking: [{ blockKey: 'b', kind: 'css' }],
					structuralCoreTokens: [],
					landmarks: [],
					siblingClusterKeys: [],
				},
			],
		};
		const call = run.takeOutput();
		native.calls[0]!.resolve(0);
		await expect(call).rejects.toThrow(
			'template classification blocking reason of kind "css" is missing "distinctiveStylesheetHrefs"',
		);
	});

	it('converts every blocking kind and landmark type with the stored key order', async () => {
		const { run, native } = start();
		const landmark = (type: string, rate: number) => ({
			type,
			memberCountWithInstance: 4,
			shellTokens: [`body>${type}`],
			chromeRate: rate,
			presenceRate: 1,
		});
		native.output = {
			sampledBlocks: [],
			keys: ['k'],
			keyOfPage: new Uint32Array([0]),
			reasons: [
				{
					clusterKey: 'k',
					memberCount: 4,
					blocking: [
						{
							pathKey: 'ignored',
							distinctiveStylesheetHrefs: ['https://example.com/a.css'],
							kind: 'css',
							blockKey: 'css:1',
						},
						{ pathKey: 'news', kind: 'orphanMerge', blockKey: 'path:news' },
						{ pathKey: 'about', kind: 'path', blockKey: 'path:about' },
					],
					structuralCoreTokens: ['body>main'],
					landmarks: [landmark('aside', 0.5), landmark('form', 1), landmark('search', 0)],
					siblingClusterKeys: ['s'],
				},
			],
		};
		const call = run.takeOutput();
		native.calls[0]!.resolve(0);
		const { reasons } = await call;
		expect(JSON.stringify(reasons.get('k'))).toBe(
			'{"memberCount":4,"blocking":[{"blockKey":"css:1","reason":{"kind":"css","distinctiveStylesheetHrefs":["https://example.com/a.css"]}},{"blockKey":"path:news","reason":{"kind":"orphanMerge","pathKey":"news"}},{"blockKey":"path:about","reason":{"kind":"path","pathKey":"about"}}],"structuralCoreTokens":["body>main"],"landmarks":{"aside":{"presenceRate":1,"chromeRate":0.5,"shellTokens":["body>aside"],"memberCountWithInstance":4},"form":{"presenceRate":1,"chromeRate":1,"shellTokens":["body>form"],"memberCountWithInstance":4},"search":{"presenceRate":1,"chromeRate":0,"shellTokens":["body>search"],"memberCountWithInstance":4}},"siblingClusterKeys":["s"]}',
		);
	});

	it('fails the run on a rejected call and drops the events that call sent', async () => {
		const events: TemplateClassificationProgress[] = [];
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
		const busy = new Error('a TemplateClassificationRun call is still running');
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

	it('hands over each stylesheet href with its new URL host, null where it throws', () => {
		const { run, native } = start();
		const pushSignals = vi.spyOn(native, 'pushSignals');
		run.pushSignals([
			{ paths: ['a'], stylesheetHrefs: ['https://EXAMPLE.com:443/a.css', 'not a url'] },
			{
				paths: ['b'],
				stylesheetHrefs: ['https://example.com/a.css'],
				host: 'example.com',
			},
		]);
		expect(pushSignals).toHaveBeenCalledWith([
			{
				paths: ['a'],
				stylesheetHrefs: ['https://EXAMPLE.com:443/a.css', 'not a url'],
				stylesheetHosts: ['example.com', null],
			},
			{
				paths: ['b'],
				stylesheetHrefs: ['https://example.com/a.css'],
				stylesheetHosts: ['example.com'],
				host: 'example.com',
			},
		]);
	});
});
