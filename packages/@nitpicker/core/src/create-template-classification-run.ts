import type {
	CreateTemplateClassificationRunOptions,
	NativeTemplateClassificationOutput,
	NativeTemplateClassificationProgress,
	NativeTemplateClassificationRun,
	TemplateBlockingReason,
	TemplateClassificationOutput,
	TemplateClassificationProgress,
	TemplateClassificationRun,
	TemplateClassificationProgressState,
	TemplateClusterReason,
	TemplateLandmarkProfile,
	TemplateLandmarkType,
	TemplateSampleReason,
} from './types.js';

import { nativeBinding } from './native-binding.js';

/**
 * A field the addon must report, read by its key so the name in the error is
 * the field actually read; throws when it is missing.
 * @param read - The record, the field's key, and what the record is, for the error.
 * @param read.from - As the addon reports it.
 * @param read.field - The field's key.
 * @param read.context - What the record is.
 * @returns The field's value, defined.
 */
function required<R, K extends keyof R & string>(read: {
	readonly from: R;
	readonly field: K;
	readonly context: string;
}): Exclude<R[K], undefined> {
	const value = read.from[read.field];
	if (value === undefined) {
		throw new Error(`template classification ${read.context} is missing "${read.field}"`);
	}
	return value as Exclude<R[K], undefined>;
}

/**
 * The landmark types a reason's `landmarks` may name, as a record so the
 * compiler checks it lists exactly {@link TemplateLandmarkType}'s members.
 */
const LANDMARK_TYPES: Readonly<Record<TemplateLandmarkType, true>> = {
	header: true,
	footer: true,
	nav: true,
	aside: true,
	form: true,
	search: true,
};

/**
 * Whether `type` is one of {@link LANDMARK_TYPES}.
 * @param type - As the addon reports it.
 */
function isLandmarkType(type: string): type is TemplateLandmarkType {
	return Object.hasOwn(LANDMARK_TYPES, type);
}

/**
 * Wakes a call waiting for its progress events.
 * @param state - The run's progress state.
 */
function releaseWait(state: TemplateClassificationProgressState): void {
	const resolve = state.onDelivered;
	state.onDelivered = undefined;
	resolve?.();
}

/**
 * The callback the addon reports progress to. Built here, outside
 * `createTemplateClassificationRun`, so its closure holds only `state` and
 * `onProgress`: V8 gives the closures of one function a shared context, and
 * the addon keeps this callback alive for as long as the run lives, so a
 * callback created next to the run's methods would hold the run strongly
 * and the pair could never be collected.
 * @param state - The run's progress state.
 * @param onProgress - The caller's callback.
 * @returns The callback for the addon.
 */
function createProgressCallback(
	state: TemplateClassificationProgressState,
	onProgress: (event: TemplateClassificationProgress) => void,
): (event: NativeTemplateClassificationProgress) => void {
	return (event) => {
		state.delivered++;
		// After a failure the caller has its error; later events of the
		// failed call would only arrive out of turn.
		if (!state.failure) {
			try {
				onProgress(toProgress(event));
			} catch (error) {
				// Thrown here it would surface as an uncaught exception on the
				// addon's callback, not to whoever awaits the run.
				state.failure = { error };
				state.nativeRef?.deref()?.cancel();
			}
		}
		if (state.delivered >= state.expected) releaseWait(state);
	};
}

/**
 * Narrows a sampling reason the addon reports.
 * @param reason - As the addon reports it.
 * @returns The typed reason.
 * @throws {Error} On a reason the wrapper does not know.
 */
function toSampleReason(reason: string): TemplateSampleReason {
	if (reason === 'table-over-budget' || reason === 'pages-over-limit') {
		return reason;
	}
	throw new Error(`unknown template classification sample reason "${reason}"`);
}

/**
 * Narrows the addon's flat progress record to
 * {@link TemplateClassificationProgress}.
 * @param event - As the addon reports it.
 * @returns The typed event.
 * @throws {Error} On a phase the wrapper does not know or a field the phase
 *   needs missing: the addon and the wrapper disagree, which is not for a
 *   default to hide.
 */
function toProgress(
	event: NativeTemplateClassificationProgress,
): TemplateClassificationProgress {
	const context = `progress phase "${event.phase}"`;
	switch (event.phase) {
		case 'block-sampled': {
			return {
				phase: 'block-sampled',
				blockKey: required({ from: event, field: 'blockKey', context }),
				pageCount: required({ from: event, field: 'pageCount', context }),
				pairBytes: required({ from: event, field: 'pairBytes', context }),
				budget: required({ from: event, field: 'budget', context }),
				reason: toSampleReason(required({ from: event, field: 'reason', context })),
			};
		}
		case 'pass1b-assign': {
			return {
				phase: 'pass1b-assign',
				pagesAssigned: required({ from: event, field: 'pagesAssigned', context }),
				pagesToAssign: required({ from: event, field: 'pagesToAssign', context }),
			};
		}
		case 'stage-b-start': {
			return {
				phase: 'stage-b-start',
				unitCount: required({ from: event, field: 'unitCount', context }),
			};
		}
		case 'pass1-block-complete': {
			return {
				phase: 'pass1-block-complete',
				blockKey: required({ from: event, field: 'blockKey', context }),
				blocksProcessed: required({ from: event, field: 'blocksProcessed', context }),
				totalBlocks: required({ from: event, field: 'totalBlocks', context }),
			};
		}
		default: {
			throw new Error(`unknown template classification progress phase "${event.phase}"`);
		}
	}
}

/**
 * One blocking reason of the addon's flat record as a
 * {@link TemplateBlockingReason}, keys in the order the stored JSON has them.
 * @param entry - As the addon returns it.
 * @returns The typed reason.
 * @throws {Error} On a kind the wrapper does not know or a field the kind
 *   needs missing.
 */
function toBlockingReason(
	entry: NativeTemplateClassificationOutput['reasons'][number]['blocking'][number],
): TemplateBlockingReason {
	const context = `blocking reason of kind "${entry.kind}"`;
	switch (entry.kind) {
		case 'css': {
			return {
				kind: 'css',
				distinctiveStylesheetHrefs: required({
					from: entry,
					field: 'distinctiveStylesheetHrefs',
					context,
				}),
			};
		}
		case 'path':
		case 'orphanMerge': {
			return {
				kind: entry.kind,
				pathKey: required({ from: entry, field: 'pathKey', context }),
			};
		}
		default: {
			throw new Error(
				`unknown template classification blocking reason kind "${entry.kind}"`,
			);
		}
	}
}

/**
 * `new URL(href).host`, or `null` where it throws. Taken from the platform
 * so the URL standard's host rules (IDNA included) are applied as browsers
 * apply them.
 * @param href - A stylesheet href.
 * @returns Its host.
 */
function hostOf(href: string): string | null {
	try {
		return new URL(href).host;
	} catch {
		return null;
	}
}

/**
 * Turns the addon's flattened reasons into {@link TemplateClusterReason}s,
 * building every object with its keys in the order the stored JSON has them.
 * @param reasons - As the addon returns them.
 * @returns By cluster key, in the addon's order.
 * @throws {Error} On a landmark type or blocking kind the wrapper does not
 *   know, a landmark type listed twice, or a field a blocking kind needs
 *   missing.
 */
function toReasons(
	reasons: NativeTemplateClassificationOutput['reasons'],
): Map<string, TemplateClusterReason> {
	const result = new Map<string, TemplateClusterReason>();
	for (const reason of reasons) {
		const landmarks: { [Type in TemplateLandmarkType]?: TemplateLandmarkProfile } = {};
		for (const landmark of reason.landmarks) {
			if (!isLandmarkType(landmark.type)) {
				throw new Error(
					`unknown template classification landmark type "${landmark.type}"`,
				);
			}
			if (Object.hasOwn(landmarks, landmark.type)) {
				throw new Error(
					`template classification reason of "${reason.clusterKey}" lists landmark type "${landmark.type}" twice`,
				);
			}
			landmarks[landmark.type] = {
				presenceRate: landmark.presenceRate,
				chromeRate: landmark.chromeRate,
				shellTokens: landmark.shellTokens,
				memberCountWithInstance: landmark.memberCountWithInstance,
			};
		}
		result.set(reason.clusterKey, {
			memberCount: reason.memberCount,
			blocking: reason.blocking.map((entry) => ({
				blockKey: entry.blockKey,
				reason: toBlockingReason(entry),
			})),
			structuralCoreTokens: reason.structuralCoreTokens,
			landmarks,
			siblingClusterKeys: reason.siblingClusterKeys,
		});
	}
	return result;
}

/**
 * Starts a template classification run in the native addon: Pass 0 splits
 * the pages into blocks by URL section and stylesheets, Stage A clusters
 * each block by DOM structure, Stage B merges clusters across blocks and
 * explains each final one.
 *
 * The caller reads the corpus and hands it over: the signals of every page,
 * then the HTML once or twice. Each computing call does its work on the
 * addon's own thread pool (not Node's main thread, not libuv's), so the
 * caller can read the next batch while one is processed. The keys and
 * reasons are the ones stored in existing archives, byte for byte
 * (`@nitpicker/archive`'s golden records pin them).
 *
 * Every block is clustered whole — every page kept until its block is
 * clustered, landmark chrome judged across all of those blocks' pages —
 * unless its Stage A similarity table (`n * (n - 1) / 2 * 8` bytes for `n`
 * pages) would exceed `memoryBudget`, or unless the blocks clustered whole
 * would hold more than `TEMPLATE_EXACT_PAGE_LIMIT` pages together (the
 * largest blocks of more than `TEMPLATE_BLOCK_SAMPLE_SIZE` pages are then
 * sampled until they fit, or none is left). Such a block keeps a deterministic
 * sample of `TEMPLATE_BLOCK_SAMPLE_SIZE` pages instead, chrome is judged
 * within the sample, and the second read assigns every other page of the
 * block to the nearest sampled cluster; `block()` reports each one as a
 * `block-sampled` event and `takeOutput()` lists them in `sampledBlocks`.
 * Every read pushes every page in corpus order; `pageMask()` tells which
 * ones the read uses, so the others can go with empty HTML (and need not be
 * read at all).
 * @param options - See {@link CreateTemplateClassificationRunOptions}.
 * @returns The run.
 * @throws {RangeError} When `memoryBudget` is negative or not a finite number.
 * @example
 * ```ts
 * const run = createTemplateClassificationRun();
 * run.pushSignals([
 * 	{ paths: ['news', '1'], stylesheetHrefs: [] },
 * 	{ paths: ['news', '2'], stylesheetHrefs: [] },
 * ]);
 * await run.block();
 * await run.pushPages([
 * 	{ html: '<body><main><p>a</p></main></body>' },
 * 	{ html: '<body><main><p>b</p></main></body>' },
 * ]);
 * await run.finishPages();
 * const { keys, keyOfPage } = await run.takeOutput();
 * keys[keyOfPage[0]!]; // '["path:news","cluster:0"]'
 * ```
 */
export function createTemplateClassificationRun(
	options: Partial<CreateTemplateClassificationRunOptions> = {},
): TemplateClassificationRun {
	const { onProgress, memoryBudget } = options;
	// A NaN or negative budget would reach the addon as 0 and silently
	// sample every block, which stores different keys.
	if (
		memoryBudget !== undefined &&
		!(Number.isFinite(memoryBudget) && memoryBudget >= 0)
	) {
		throw new RangeError(
			`createTemplateClassificationRun: memoryBudget must be a non-negative number of bytes, got ${memoryBudget}`,
		);
	}
	const state: TemplateClassificationProgressState = {
		delivered: 0,
		expected: 0,
		onDelivered: undefined,
		failure: undefined,
		nativeRef: undefined,
	};
	// Pages of a site share their stylesheets, so each href is parsed once.
	const hosts = new Map<string, string | null>();

	const native: NativeTemplateClassificationRun =
		new nativeBinding.TemplateClassificationRun(
			onProgress ? createProgressCallback(state, onProgress) : undefined,
			memoryBudget,
		);
	// The callback first runs after the constructor returns.
	state.nativeRef = new WeakRef(native);

	const throwIfFailed = () => {
		if (state.failure) throw state.failure.error;
	};
	/**
	 * Awaits a computing call, then the progress events it sent, which travel
	 * separately from its promise. A rejected call fails the run: the events
	 * it sent before failing are not counted, so later calls could no longer
	 * tell their own events apart.
	 * @param call - Starts the addon's call.
	 * @param sentOf - The number of events the call's result says it sent.
	 */
	const settle = async <T>(call: () => Promise<T>, sentOf: (value: T) => number) => {
		throwIfFailed();
		// Thrown synchronously — the run was busy — the call never started, so
		// the run is unaffected.
		const pending = call();
		let value: T;
		try {
			value = await pending;
		} catch (error) {
			state.failure ??= { error };
			throw state.failure.error;
		}
		state.expected += sentOf(value);
		if (state.delivered < state.expected) {
			// The addon's callback does not keep Node's event loop alive, so
			// this timer does while the events are on their way.
			const keepAlive = setInterval(() => {}, 60_000);
			try {
				await new Promise<void>((resolve) => {
					state.onDelivered = resolve;
				});
			} finally {
				clearInterval(keepAlive);
			}
		}
		throwIfFailed();
		return value;
	};
	const count = (sent: number) => sent;

	return {
		pushSignals: (signals) => {
			throwIfFailed();
			native.pushSignals(
				signals.map((page) => ({
					paths: page.paths,
					stylesheetHrefs: page.stylesheetHrefs,
					stylesheetHosts: page.stylesheetHrefs.map((href) => {
						let host = hosts.get(href);
						if (host === undefined) {
							host = hostOf(href);
							hosts.set(href, host);
						}
						return host;
					}),
					...(page.host === undefined ? {} : { host: page.host }),
				})),
			);
		},
		block: async () => {
			await settle(() => native.block(), count);
			hosts.clear();
		},
		pushPages: async (pages) => {
			await settle(() => native.pushPages(pages), count);
		},
		finishPages: async () => {
			await settle(() => native.finishPages(), count);
		},
		pageMask: () => native.pageMask(),
		needsAssignment: () => native.needsAssignment(),
		pushAssignmentPages: async (pages) => {
			await settle(() => native.pushAssignmentPages(pages), count);
		},
		takeOutput: async (): Promise<TemplateClassificationOutput> => {
			const { output } = await settle(
				() => native.takeOutput(),
				({ sent }) => sent,
			);
			return {
				keys: output.keys,
				keyOfPage: output.keyOfPage,
				reasons: toReasons(output.reasons),
				sampledBlocks: output.sampledBlocks.map((block) => ({
					...block,
					reason: toSampleReason(block.reason),
				})),
			};
		},
		cancel: () => {
			native.cancel();
			// Events only fail to arrive when Node is tearing the addon down;
			// a cancel must not leave a call waiting on them forever.
			releaseWait(state);
		},
	};
}
