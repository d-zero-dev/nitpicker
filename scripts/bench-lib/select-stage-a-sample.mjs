import {
	BLOCK_SAMPLE_SIZE,
	CORPUS_INLINE_THRESHOLD,
} from '../../packages/@nitpicker/archive/lib/template-classification/page-cluster/resolve-page-cluster-keys.js';

/**
 * Picks the pages of one block that page-cluster's Stage A runs on, in the
 * order it runs on them.
 *
 * Up to `CORPUS_INLINE_THRESHOLD` classified pages the engine stays on its
 * in-memory path and Stage A sees the whole block in stream order. Above it
 * the streaming path keeps a reservoir sample of at most
 * `BLOCK_SAMPLE_SIZE` pages per block and assigns the rest afterwards by
 * Jaccard similarity (Pass 1b). Its sampler is private to
 * `resolve-page-cluster-keys.ts` (`fnv1a32` + `makeSeededPrng` + the
 * Algorithm R loop in Pass 1), so it is reproduced here — the sample's
 * reservoir-slot order included, because Stage A's dendrogram, cut and
 * containment steps can resolve ties differently in another order. A
 * change to that sampler must be followed here by hand: no test can see the
 * private copy. `select-stage-a-sample.spec.mjs` pins the picked set to the
 * engine's exported `reservoirSample`, which uses the same PRNG and seed
 * hash, so it catches a change made to both but not one made only to Pass
 * 1. Exporting Pass 1's sampler would close that gap at the cost of a
 * production change made only for this bench.
 * @param {{ indices: readonly number[]; blockKey: string; corpusSize: number }} params
 *   The block's page indices in stream order, its key, and the number of
 *   classified pages in the whole corpus.
 * @returns {{ sample: number[]; rest: number[] }} Stage A's pages in the
 *   engine's order, and the ones left for Pass 1b in stream order.
 * @example
 * const { sample, rest } = selectStageASample({ indices, blockKey, corpusSize: members.length });
 */
export function selectStageASample(params) {
	const { indices, blockKey, corpusSize } = params;
	if (corpusSize <= CORPUS_INLINE_THRESHOLD) {
		return { sample: [...indices], rest: [] };
	}
	const random = seededRandom(blockKey);
	const sample = [];
	for (const [seenCount, index] of indices.entries()) {
		if (sample.length < BLOCK_SAMPLE_SIZE) {
			sample.push(index);
			continue;
		}
		const slot = Math.floor(random() * (seenCount + 1));
		if (slot < BLOCK_SAMPLE_SIZE) {
			sample[slot] = index;
		}
	}
	const sampled = new Set(sample);
	return { sample, rest: indices.filter((index) => !sampled.has(index)) };
}

/**
 * The streaming path's per-block PRNG: mulberry32 seeded with the FNV-1a
 * 32-bit hash of the block key.
 * @param {string} seed - The block key.
 * @returns {() => number} A generator of numbers in `[0, 1)`.
 */
function seededRandom(seed) {
	let hash = 2_166_136_261;
	for (let i = 0; i < seed.length; i++) {
		hash ^= seed.codePointAt(i) ?? 0;
		hash = Math.imul(hash, 16_777_619);
	}
	let state = hash >>> 0;
	return () => {
		state = (state + 1_831_565_813) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}
