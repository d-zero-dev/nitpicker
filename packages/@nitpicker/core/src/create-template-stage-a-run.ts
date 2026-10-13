import type {
	CreateTemplateStageARunOptions,
	NativeStageAProgress,
	NativeTemplateStageARun,
	StageAProgress,
	TemplateStageARun,
} from './types.js';

import { nativeBinding } from './native-binding.js';

/**
 * Narrows the addon's flat progress record to {@link StageAProgress}.
 * @param event - As the addon reports it.
 * @returns The typed event.
 */
function toStageAProgress(event: NativeStageAProgress): StageAProgress {
	if (event.phase === 'pass1b-assign') {
		return {
			phase: 'pass1b-assign',
			pagesAssigned: event.pagesAssigned ?? 0,
			pagesToAssign: event.pagesToAssign ?? 0,
		};
	}
	return {
		phase: 'pass1-block-complete',
		blockKey: event.blockKey ?? '',
		blocksProcessed: event.blocksProcessed ?? 0,
		totalBlocks: event.totalBlocks ?? 0,
	};
}

/**
 * Starts Stage A of a template classification run in the native addon:
 * from each page's HTML to the structural clusters of its Pass-0 block, and
 * the units Stage B merges across blocks.
 *
 * The caller reads the pages and hands them over in batches; each call does
 * its work on the addon's own thread pool (not Node's main thread, not
 * libuv's), so the caller can read the next batch while one is processed.
 * The keys are the ones stored in existing archives, byte for byte
 * (`@nitpicker/archive`'s golden records pin them).
 *
 * In memory, every page is kept until its block is clustered and landmark
 * chrome is judged across the whole corpus. Streaming, each block keeps a
 * deterministic sample of `TEMPLATE_BLOCK_SAMPLE_SIZE` pages (decided
 * upfront from `blockOfPage` and the block keys), chrome is judged per
 * sampled block, and the second read assigns every other page to the
 * nearest sampled cluster. Every read pushes every page in corpus order;
 * `pageMask()` tells which ones the read uses, so the others can go with
 * empty HTML.
 * @param options - See {@link CreateTemplateStageARunOptions}.
 * @returns The run.
 * @throws {Error} When `blockOfPage` names a block outside `blockKeys`, or a
 *   block has no pages.
 * @example
 * ```ts
 * const run = createTemplateStageARun({
 * 	blockKeys: ['path:news'],
 * 	blockOfPage: Uint32Array.of(0, 0),
 * 	streaming: false,
 * });
 * await run.pushPages([
 * 	{ html: '<body><main><p>a</p></main></body>' },
 * 	{ html: '<body><main><p>b</p></main></body>' },
 * ]);
 * await run.finishPages();
 * const { keys, keyOfPage } = await run.takeOutput();
 * keys[keyOfPage[0]!]; // '["path:news","cluster:0"]'
 * ```
 */
export function createTemplateStageARun(
	options: CreateTemplateStageARunOptions,
): TemplateStageARun {
	const { onProgress } = options;
	let delivered = 0;
	let expected = 0;
	let onDelivered: (() => void) | undefined;
	let failure: { readonly error: unknown } | undefined;

	const releaseWait = () => {
		const resolve = onDelivered;
		onDelivered = undefined;
		resolve?.();
	};
	// The callback must not hold the run strongly: the addon keeps the
	// callback alive for as long as the run lives, so a strong reference back
	// would make the pair unreachable for the garbage collector. (`nativeRef`
	// is declared below; the callback first runs after the constructor returns.)
	const native: NativeTemplateStageARun = new nativeBinding.TemplateStageARun(
		options.blockKeys,
		options.blockOfPage,
		options.streaming,
		onProgress
			? (event) => {
					delivered++;
					// After a failure the caller has its error; later events of the
					// failed call would only arrive out of turn.
					if (!failure) {
						try {
							onProgress(toStageAProgress(event));
						} catch (error) {
							// Thrown here it would surface as an uncaught exception on
							// the addon's callback, not to whoever awaits the run.
							failure = { error };
							nativeRef.deref()?.cancel();
						}
					}
					if (delivered >= expected) releaseWait();
				}
			: undefined,
	);
	const nativeRef = new WeakRef(native);

	const throwIfFailed = () => {
		if (failure) throw failure.error;
	};
	/**
	 * Awaits a reading call, then the progress events it sent, which travel
	 * separately from its promise. A rejected call fails the run: the events
	 * it sent before failing are not counted, so later calls could no longer
	 * tell their own events apart.
	 * @param call - Starts the addon's call, a promise of the number of events sent.
	 */
	const settle = async (call: () => Promise<number>) => {
		throwIfFailed();
		// Thrown synchronously — the run was busy — the call never started, so
		// the run is unaffected.
		const pending = call();
		let sent: number;
		try {
			sent = await pending;
		} catch (error) {
			failure ??= { error };
			throw failure.error;
		}
		expected += sent;
		if (delivered < expected) {
			// The addon's callback does not keep Node's event loop alive, so
			// this timer does while the events are on their way.
			const keepAlive = setInterval(() => {}, 60_000);
			try {
				await new Promise<void>((resolve) => {
					onDelivered = resolve;
				});
			} finally {
				clearInterval(keepAlive);
			}
		}
		throwIfFailed();
	};

	return {
		pushPages: (pages) => settle(() => native.pushPages(pages)),
		finishPages: () => settle(() => native.finishPages()),
		pageMask: () => native.pageMask(),
		needsAssignment: () => native.needsAssignment(),
		pushAssignmentPages: (pages) => settle(() => native.pushAssignmentPages(pages)),
		takeOutput: async () => {
			throwIfFailed();
			return native.takeOutput();
		},
		cancel: () => {
			native.cancel();
			// Events only fail to arrive when Node is tearing the addon down;
			// a cancel must not leave a call waiting on them forever.
			releaseWait();
		},
	};
}
