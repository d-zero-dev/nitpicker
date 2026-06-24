import { describe, expect, it } from 'vitest';

import { resolveRedirectChain } from './resolve-redirect-chain.js';

/**
 * Direct unit tests for the redirect-chain walker. Cluster computation and
 * link-dest resolution both rely on this returning either the terminal
 * destination or `null` (cycle) — so each branch is pinned explicitly with
 * hand-built `redirectMap` fixtures (no archive DB required).
 */
describe('resolveRedirectChain', () => {
	it('returns the input id unchanged when it is not a redirect source', () => {
		const map = new Map<number, number>();
		expect(resolveRedirectChain(42, map)).toBe(42);
	});

	it('follows a single-hop chain to its destination', () => {
		const map = new Map([[1, 2]]);
		expect(resolveRedirectChain(1, map)).toBe(2);
	});

	it('follows a multi-hop chain to the terminal node', () => {
		const map = new Map([
			[1, 2],
			[2, 3],
			[3, 4],
		]);
		expect(resolveRedirectChain(1, map)).toBe(4);
	});

	it('returns null on a direct self-loop', () => {
		const map = new Map([[7, 7]]);
		expect(resolveRedirectChain(7, map)).toBeNull();
	});

	it('returns null on a multi-node cycle', () => {
		// 1 → 2 → 3 → 1 (back to start)
		const map = new Map([
			[1, 2],
			[2, 3],
			[3, 1],
		]);
		expect(resolveRedirectChain(1, map)).toBeNull();
	});

	it('starts from any node in the cycle and still reports null', () => {
		const map = new Map([
			[1, 2],
			[2, 3],
			[3, 1],
		]);
		expect(resolveRedirectChain(2, map)).toBeNull();
		expect(resolveRedirectChain(3, map)).toBeNull();
	});

	it('returns the terminal node when the chain enters but never closes the cycle', () => {
		// 1 → 2 → 3 (terminal); no edge back from 3.
		const map = new Map([
			[1, 2],
			[2, 3],
		]);
		expect(resolveRedirectChain(1, map)).toBe(3);
	});

	it('treats independent chains in the same map independently', () => {
		const map = new Map([
			[1, 2],
			[10, 20],
			[20, 30],
		]);
		expect(resolveRedirectChain(1, map)).toBe(2);
		expect(resolveRedirectChain(10, map)).toBe(30);
		expect(resolveRedirectChain(99, map)).toBe(99);
	});
});
