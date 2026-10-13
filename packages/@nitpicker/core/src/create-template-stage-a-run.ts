import type {
	CreateTemplateStageARunOptions,
	NativeStageAProgress,
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
 * The keys produced are byte-identical to the JavaScript engine they
 * replace (`@nitpicker/archive`'s golden records pin them).
 *
 * In memory, every page is kept until its block is clustered and landmark
 * chrome is judged across the whole corpus. Streaming, each block keeps a
 * deterministic sample of 100 pages (sampling follows corpus order, so pages
 * must arrive in the same order on both reads), chrome is judged per
 * sampled block, and the second read assigns every other page to the
 * nearest sampled cluster.
 * @param options - See {@link CreateTemplateStageARunOptions}.
 * @returns The run.
 * @throws {Error} When `blockOfPage` names a block outside `blockKeys`.
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
	return new nativeBinding.TemplateStageARun(
		options.blockKeys,
		options.blockOfPage,
		options.streaming,
		onProgress ? (event) => onProgress(toStageAProgress(event)) : undefined,
	);
}
