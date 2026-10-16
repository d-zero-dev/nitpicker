/**
 * Pins the native `groupAliasCandidates` to the grouping and election
 * `backfillAliasOfId` computes, written out here in plain JavaScript:
 * buckets by `(Tier A key, title)` and `(Tier B key, title, body hash)`, a
 * union-find over the bucket members, and the representative chosen by the
 * most in-group canonical pointers, then the shortest URL, then string order.
 * The keys come from the JavaScript oracle (`parse-alias-key-parts.ts`), so
 * this spec pins the whole path. `content_items.alias_of_id` in existing
 * archives was written by the reference, so any divergence would regroup
 * pages on the next `viewer-build`.
 */
import type { AliasCandidate } from '@nitpicker/core/types';

import { describe, it, expect } from 'vitest';

import { formatAliasKey } from './format-alias-key.js';
import { groupAliasCandidates } from './group-alias-candidates.js';
import { parseAliasKeyParts } from './parse-alias-key-parts.js';

/**
 * The Tier A key as the JavaScript oracle computes it.
 * @param url - The URL string.
 */
function tierA(url: string): string | null {
	const parts = parseAliasKeyParts(url);
	return parts ? formatAliasKey(parts) : null;
}

/**
 * The Tier B key as the JavaScript oracle computes it.
 * @param url - The URL string.
 */
function tierB(url: string): string | null {
	const parts = parseAliasKeyParts(url);
	if (!parts) {
		return null;
	}
	const path =
		parts.path.length > 1 && parts.path.endsWith('/')
			? parts.path.slice(0, -1)
			: parts.path;
	return formatAliasKey({ ...parts, path });
}

/**
 * The reference grouping: for each candidate, the index of its group's
 * representative or `-1`.
 * @param candidates - The candidates.
 */
function referenceRepresentatives(candidates: readonly AliasCandidate[]): number[] {
	const parent = candidates.map((_, index) => index);
	const find = (x: number): number => {
		let root = x;
		while (parent[root] !== root) {
			root = parent[root]!;
		}
		let current = x;
		while (current !== root) {
			const next = parent[current]!;
			parent[current] = root;
			current = next;
		}
		return root;
	};
	const buckets = new Map<string, number[]>();
	for (const [index, candidate] of candidates.entries()) {
		const keyA = tierA(candidate.url);
		if (keyA !== null) {
			const key = `A\u001F${keyA}\u001F${candidate.titleTextId}`;
			buckets.set(key, [...(buckets.get(key) ?? []), index]);
		}
		if (candidate.bodyHash !== null) {
			const keyB = tierB(candidate.url);
			if (keyB !== null) {
				const key = `B\u001F${keyB}\u001F${candidate.titleTextId}\u001F${Buffer.from(candidate.bodyHash).toString('hex')}`;
				buckets.set(key, [...(buckets.get(key) ?? []), index]);
			}
		}
	}
	for (const bucket of buckets.values()) {
		for (let i = 1; i < bucket.length; i++) {
			const rootA = find(bucket[0]!);
			const rootB = find(bucket[i]!);
			if (rootA !== rootB) {
				parent[rootA] = rootB;
			}
		}
	}
	const groups = new Map<number, number[]>();
	for (const index of candidates.keys()) {
		const root = find(index);
		groups.set(root, [...(groups.get(root) ?? []), index]);
	}

	const result = candidates.map(() => -1);
	for (const group of groups.values()) {
		if (group.length < 2) {
			continue;
		}
		const urls = new Set(group.map((index) => candidates[index]!.url));
		const counts = new Map<string, number>();
		for (const index of group) {
			const member = candidates[index]!;
			const canonicalUrl =
				candidates.find((other) => other.urlId === member.canonicalUrlId)?.url ?? null;
			if (canonicalUrl !== null && urls.has(canonicalUrl)) {
				counts.set(canonicalUrl, (counts.get(canonicalUrl) ?? 0) + 1);
			}
		}
		const rank = (index: number): number => counts.get(candidates[index]!.url) ?? 0;
		const pool = counts.size > 0 ? group.filter((index) => rank(index) > 0) : group;
		let best = pool[0]!;
		for (const current of pool.slice(1)) {
			const currentUrl = candidates[current]!.url;
			const bestUrl = candidates[best]!.url;
			if (rank(current) !== rank(best)) {
				best = rank(current) > rank(best) ? current : best;
			} else if (currentUrl.length !== bestUrl.length) {
				best = currentUrl.length < bestUrl.length ? current : best;
			} else if (currentUrl < bestUrl) {
				best = current;
			}
		}
		for (const index of group) {
			if (index !== best) {
				result[index] = best;
			}
		}
	}
	return result;
}

/**
 * A small deterministic generator, so a failure names the same input on every run.
 * @param seed - The start state.
 */
function createRandom(seed: number): (limit: number) => number {
	let state = seed;
	return (limit) => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return Math.floor((state / 0x1_00_00_00_00) * limit);
	};
}

const SCHEMES = ['http', 'https'];
const HOSTS = ['example.com', 'Example.com', 'example.com:8080', 'www.example.com'];
const PATHS = [
	'',
	'/',
	'/a',
	'/a/',
	'/a/index.html',
	'/a/index.php',
	'/a/INDEX.HTM',
	'/b',
	'/b/',
	'/b/index.html',
	'/a/b/',
	'/日本語/',
	'/%E6%97%A5%E6%9C%AC%E8%AA%9E/index.html',
	'/c?x=1',
	'/c/?x=1',
	'/c/index.html?x=1',
];

describe('groupAliasCandidates: native versus the reference grouping', () => {
	it('elects the same representatives for 3000 random sets of pages', () => {
		const next = createRandom(429);
		const hashes = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
		let aliased = 0;
		// How often each branch of the grouping and the election was the one that
		// decided a group, so the comparison cannot pass by never reaching one.
		const reached = {
			joinedByTierB: 0,
			threeOrMoreByBothTiers: 0,
			electedByCanonical: 0,
			tiedOnLength: 0,
		};
		for (let round = 0; round < 3000; round++) {
			const urls = new Set<string>();
			for (let count = 1 + next(14); count > 0; count--) {
				urls.add(
					`${SCHEMES[next(SCHEMES.length)]}://${HOSTS[next(HOSTS.length)]}${PATHS[next(PATHS.length)]}`,
				);
			}
			const list = [...urls];
			const candidates: AliasCandidate[] = list.map((url, index) => ({
				url,
				urlId: index + 1,
				titleTextId: 1 + next(2),
				// A canonical pointing at a page of the set, at a URL outside it, or none.
				canonicalUrlId: [null, 1 + next(list.length), 1000][next(3)] ?? null,
				bodyHash: [null, hashes[0]!, hashes[1]!][next(3)] ?? null,
			}));
			const expected = referenceRepresentatives(candidates);
			aliased += expected.filter((representative) => representative !== -1).length;
			const groups = new Map<number, number[]>();
			for (const [index, representative] of expected.entries()) {
				if (representative !== -1) {
					groups.set(representative, [
						...(groups.get(representative) ?? [representative]),
						index,
					]);
				}
			}
			for (const [representative, members] of groups) {
				if (new Set(members.map((index) => tierA(candidates[index]!.url))).size > 1) {
					reached.joinedByTierB++;
					if (members.length >= 3) {
						reached.threeOrMoreByBothTiers++;
					}
				}
				const lengths = members.map((index) => candidates[index]!.url.length);
				const shortest = Math.min(...lengths);
				if (candidates[representative]!.url.length > shortest) {
					reached.electedByCanonical++;
				} else if (lengths.filter((length) => length === shortest).length > 1) {
					reached.tiedOnLength++;
				}
			}
			expect(
				[...groupAliasCandidates(candidates)],
				JSON.stringify(
					candidates.map((c) => [
						c.url,
						c.titleTextId,
						c.canonicalUrlId,
						c.bodyHash?.[0],
					]),
				),
			).toStrictEqual(expected);
		}
		// The sets must contain groups, or the comparison above proves nothing.
		expect(aliased).toBeGreaterThan(1000);
		expect(reached.joinedByTierB).toBeGreaterThan(50);
		expect(reached.threeOrMoreByBothTiers).toBeGreaterThan(50);
		expect(reached.electedByCanonical).toBeGreaterThan(50);
		expect(reached.tiedOnLength).toBeGreaterThan(50);
	});
});
