import type { AliasCandidate } from './types.js';

import { describe, it, expect } from 'vitest';

import { groupAliasCandidates } from './group-alias-candidates.js';
import { nativeBinding } from './native-binding.js';

/**
 * A candidate with a title, no canonical and no body hash.
 * @param url - The page URL.
 * @param urlId - The URL's id.
 * @param extra - Fields to override.
 */
function page(
	url: string,
	urlId: number,
	extra: Partial<AliasCandidate> = {},
): AliasCandidate {
	return { url, urlId, titleTextId: 1, canonicalUrlId: null, bodyHash: null, ...extra };
}

describe('groupAliasCandidates', () => {
	it('points the longer URL of a Tier A pair at the shorter', () => {
		expect([
			...groupAliasCandidates([
				page('http://example.com/a/index.html', 1),
				page('https://example.com/a/', 2),
				page('https://example.com/b/', 3),
			]),
		]).toStrictEqual([1, -1, -1]);
	});

	it('never groups pages whose titles differ', () => {
		expect([
			...groupAliasCandidates([
				page('http://example.com/a/index.html', 1),
				page('https://example.com/a/', 2, { titleTextId: 2 }),
			]),
		]).toStrictEqual([-1, -1]);
	});

	it('groups a Tier B pair only when the body hashes match', () => {
		const same = new Uint8Array(32).fill(7);
		const other = new Uint8Array(32).fill(8);
		expect([
			...groupAliasCandidates([
				page('https://example.com/foo', 1, { bodyHash: same }),
				page('https://example.com/foo/', 2, { bodyHash: same }),
			]),
		]).toStrictEqual([-1, 0]);
		expect([
			...groupAliasCandidates([
				page('https://example.com/foo', 1, { bodyHash: same }),
				page('https://example.com/foo/', 2, { bodyHash: other }),
			]),
		]).toStrictEqual([-1, -1]);
		expect([
			...groupAliasCandidates([
				page('https://example.com/foo', 1),
				page('https://example.com/foo/', 2),
			]),
		]).toStrictEqual([-1, -1]);
	});

	it('elects the page the group points at with canonical over the shorter URL', () => {
		expect([
			...groupAliasCandidates([
				page('http://example.com/a/index.html', 1, { canonicalUrlId: 1 }),
				page('https://example.com/a/', 2, { canonicalUrlId: 1 }),
			]),
		]).toStrictEqual([-1, 0]);
	});

	it('ignores a canonical that points outside the group', () => {
		expect([
			...groupAliasCandidates([
				page('http://example.com/a/index.html', 1, { canonicalUrlId: 99 }),
				page('https://example.com/a/', 2),
			]),
		]).toStrictEqual([1, -1]);
	});

	it('closes a Tier A edge and a Tier B edge into one group', () => {
		const hash = new Uint8Array(32).fill(1);
		expect([
			...groupAliasCandidates([
				page('https://example.com/x/index.html', 1, { bodyHash: hash }),
				page('https://example.com/x/', 2, { bodyHash: hash }),
				page('https://example.com/x', 3, { bodyHash: hash }),
			]),
		]).toStrictEqual([2, 2, -1]);
	});

	it('breaks a length tie by UTF-16 order', () => {
		expect([
			...groupAliasCandidates([
				page('https://example.com/a/', 1),
				page('https://Example.com/a/', 2),
			]),
		]).toStrictEqual([1, -1]);
	});

	it('reads non-ASCII URLs', () => {
		expect([
			...groupAliasCandidates([
				page('https://example.com/日本語/index.html', 1),
				page('https://example.com/日本語/', 2),
			]),
		]).toStrictEqual([1, -1]);
	});

	it('returns nothing for no candidates', () => {
		expect(groupAliasCandidates([])).toHaveLength(0);
	});

	it('never groups a Tier B pair whose titles differ, even with the same body hash', () => {
		const hash = new Uint8Array(32).fill(5);
		expect([
			...groupAliasCandidates([
				page('https://example.com/foo', 1, { bodyHash: hash }),
				page('https://example.com/foo/', 2, { bodyHash: hash, titleTextId: 2 }),
			]),
		]).toStrictEqual([-1, -1]);
	});

	it('elects the page most canonicals point at over a shorter page pointed at once', () => {
		// P2 is pointed at by P1 and P3, P1 only by P2: P2 wins though P1 is shorter.
		expect([
			...groupAliasCandidates([
				page('https://example.com/a/', 1, { canonicalUrlId: 2 }),
				page('https://example.com/a/index.php', 2, { canonicalUrlId: 1 }),
				page('https://example.com/a/index.html', 3, { canonicalUrlId: 2 }),
			]),
		]).toStrictEqual([1, -1, 1]);
	});

	it('treats an empty body hash as a hash, grouping two pages that share it', () => {
		const empty = new Uint8Array();
		expect([
			...groupAliasCandidates([
				page('https://example.com/foo', 1, { bodyHash: empty }),
				page('https://example.com/foo/', 2, { bodyHash: empty }),
			]),
		]).toStrictEqual([-1, 0]);
	});

	it('does not depend on the order of the candidates', () => {
		const pages = [
			page('http://example.com/a/index.html', 1),
			page('https://example.com/a/', 2),
			page('https://example.com/a/index.php', 3),
		];
		expect([...groupAliasCandidates(pages)]).toStrictEqual([1, -1, 1]);
		expect([...groupAliasCandidates(pages.toReversed())]).toStrictEqual([1, -1, 1]);
	});

	it.each([
		['a url id a Uint32Array would wrap', { urlId: 2 ** 32 }],
		['a title text id a Uint32Array would wrap', { titleTextId: 2 ** 32 }],
		['a canonical id a Uint32Array would wrap', { canonicalUrlId: 2 ** 32 }],
		['a canonical id the addon reads as none', { canonicalUrlId: 4_294_967_295 }],
		['a negative id', { urlId: -1 }],
		['a fractional id', { titleTextId: 1.5 }],
	])('rejects %s', (_name, override) => {
		expect(() =>
			groupAliasCandidates([{ ...page('https://example.com/', 1), ...override }]),
		).toThrow(RangeError);
	});
});

describe('nativeBinding.groupAliasCandidates', () => {
	const empty = {
		urls: new Uint8Array(),
		urlOffsets: Uint32Array.of(0),
		urlIds: new Uint32Array(),
		titleTextIds: new Uint32Array(),
		canonicalUrlIds: new Uint32Array(),
		bodyHashes: new Uint8Array(),
		hashOffsets: Uint32Array.of(0),
		hashPresent: new Uint8Array(),
	};
	const oneUrl = {
		...empty,
		urls: new TextEncoder().encode('https://example.com/'),
		urlOffsets: Uint32Array.of(0, 20),
		urlIds: Uint32Array.of(1),
		titleTextIds: Uint32Array.of(1),
		canonicalUrlIds: Uint32Array.of(4_294_967_295),
		hashOffsets: Uint32Array.of(0, 0),
		hashPresent: Uint8Array.of(0),
	};

	it('groups nothing for no candidates', () => {
		expect(nativeBinding.groupAliasCandidates(empty)).toHaveLength(0);
	});

	it('answers "none" (4294967295) for a candidate alone', () => {
		expect([...nativeBinding.groupAliasCandidates(oneUrl)]).toStrictEqual([
			4_294_967_295,
		]);
	});

	it('rejects columns of different lengths', () => {
		expect(() =>
			nativeBinding.groupAliasCandidates({ ...oneUrl, urlIds: Uint32Array.of(1, 2) }),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('rejects URL offsets that run past the bytes', () => {
		expect(() =>
			nativeBinding.groupAliasCandidates({
				...oneUrl,
				urlOffsets: Uint32Array.of(0, 99),
			}),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('rejects hash offsets that do not start at 0', () => {
		expect(() =>
			nativeBinding.groupAliasCandidates({
				...oneUrl,
				hashOffsets: Uint32Array.of(1, 1),
			}),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('rejects URL bytes that are not UTF-8', () => {
		expect(() =>
			nativeBinding.groupAliasCandidates({
				...oneUrl,
				urls: Uint8Array.of(255, 254),
				urlOffsets: Uint32Array.of(0, 2),
			}),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});
});
