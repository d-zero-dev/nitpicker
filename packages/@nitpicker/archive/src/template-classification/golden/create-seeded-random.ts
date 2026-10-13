/**
 * Creates a deterministic PRNG (mulberry32) returning floats in `[0, 1)`.
 * The golden corpora are regenerated on every test run rather than
 * committed, so they must come out byte-identical on every machine and
 * Node version — `Math.random` cannot be seeded.
 * @param seed - Any 32-bit integer.
 * @returns The next-value function.
 * @example
 * ```ts
 * const random = createSeededRandom(426);
 * const coin = random() < 0.5;
 * ```
 */
export function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		// mulberry32's increment, 0x6D2B79F5.
		state = (state + 1_831_565_813) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}
