import { describe, it, expect } from 'vitest';

import { computeContentHash } from './compute-content-hash.js';
import { decomposeHeaderSet } from './decompose-header-set.js';

describe('decomposeHeaderSet (header-set-decomposition)', () => {
	it('returns null for null / empty / no-op inputs', () => {
		expect(decomposeHeaderSet(null)).toBeNull();
		expect(decomposeHeaderSet('')).toBeNull();
		expect(decomposeHeaderSet('null')).toBeNull();
		expect(decomposeHeaderSet('{}')).toBeNull();
	});

	it('returns null for malformed JSON', () => {
		expect(decomposeHeaderSet('{not-json')).toBeNull();
		expect(decomposeHeaderSet('[]')).toBeNull();
		expect(decomposeHeaderSet('"a-string"')).toBeNull();
	});

	it('lower-cases header names', () => {
		const out = decomposeHeaderSet(
			JSON.stringify({ 'Content-Type': 'text/html', 'X-Foo': 'bar' }),
		);
		expect(out).not.toBeNull();
		expect(out!.entries.map((entry) => entry.name)).toEqual(['content-type', 'x-foo']);
	});

	it('sorts entries by (name, occurrence)', () => {
		const out = decomposeHeaderSet(
			JSON.stringify({
				'z-last': 'z',
				'a-first': '1',
			}),
		);
		expect(out!.entries.map((entry) => entry.name)).toEqual(['a-first', 'z-last']);
	});

	it('expands array values (multiple same-name headers)', () => {
		const out = decomposeHeaderSet(
			JSON.stringify({
				'set-cookie': ['session=abc', 'csrf=xyz'],
				'content-type': 'text/html',
			}),
		);
		expect(out).not.toBeNull();
		expect(out!.entryCount).toBe(3);
		const cookieEntries = out!.entries.filter((e) => e.name === 'set-cookie');
		expect(cookieEntries.map((e) => e.occurrence)).toEqual([1, 2]);
		expect(cookieEntries.map((e) => e.value)).toEqual(['session=abc', 'csrf=xyz']);
	});

	it('marks known volatile headers as volatile', () => {
		const out = decomposeHeaderSet(
			JSON.stringify({
				'content-type': 'text/html',
				date: 'Wed, 21 Oct 2015 07:28:00 GMT',
				etag: 'W/"abc"',
			}),
		);
		const byName = new Map(out!.entries.map((e) => [e.name, e.isVolatile]));
		expect(byName.get('content-type')).toBe(false);
		expect(byName.get('date')).toBe(true);
		expect(byName.get('etag')).toBe(true);
	});

	it('produces distinct raw_hash vs stable_hash when volatile headers exist', () => {
		const out = decomposeHeaderSet(
			JSON.stringify({
				'content-type': 'text/html',
				date: 'Wed, 21 Oct 2015 07:28:00 GMT',
			}),
		);
		expect(out!.rawHash.equals(out!.stableHash)).toBe(false);
		expect(out!.volatileHash).not.toBeNull();
	});

	it('has null volatile_hash and equal stable/raw hashes when only stable headers exist', () => {
		const out = decomposeHeaderSet(
			JSON.stringify({
				'content-type': 'text/html',
				'cache-control': 'no-store',
			}),
		);
		expect(out!.volatileHash).toBeNull();
		expect(out!.rawHash.equals(out!.stableHash)).toBe(true);
	});

	it('stable_hash is invariant to insertion order', () => {
		const a = decomposeHeaderSet(
			JSON.stringify({ 'content-type': 'text/html', 'cache-control': 'no-store' }),
		);
		const b = decomposeHeaderSet(
			JSON.stringify({ 'cache-control': 'no-store', 'content-type': 'text/html' }),
		);
		expect(a!.stableHash.equals(b!.stableHash)).toBe(true);
	});

	it('stable_hash is invariant to volatile-header changes', () => {
		const a = decomposeHeaderSet(
			JSON.stringify({
				'content-type': 'text/html',
				date: 'Wed, 21 Oct 2015 07:28:00 GMT',
			}),
		);
		const b = decomposeHeaderSet(
			JSON.stringify({
				'content-type': 'text/html',
				date: 'Thu, 22 Oct 2015 07:28:00 GMT',
			}),
		);
		expect(a!.stableHash.equals(b!.stableHash)).toBe(true);
		// but raw_hash differs
		expect(a!.rawHash.equals(b!.rawHash)).toBe(false);
	});

	it('stable_hash trims value whitespace so leading/trailing space does not fork dedup', () => {
		const a = decomposeHeaderSet(JSON.stringify({ 'content-type': 'text/html' }));
		const b = decomposeHeaderSet(JSON.stringify({ 'content-type': '  text/html  ' }));
		expect(a!.stableHash.equals(b!.stableHash)).toBe(true);
	});

	it('rawJsonHash hashes the exact raw string', () => {
		const raw = JSON.stringify({ a: 'b' });
		const out = decomposeHeaderSet(raw);
		expect(out!.rawJsonHash.equals(computeContentHash(raw))).toBe(true);
	});

	it('counts entries correctly with multi-value headers', () => {
		const out = decomposeHeaderSet(
			JSON.stringify({
				'set-cookie': ['a=1', 'b=2', 'c=3'],
				'content-type': 'text/html',
			}),
		);
		expect(out!.entryCount).toBe(4);
		// set-cookie is volatile, content-type is stable
		expect(out!.stableEntryCount).toBe(1);
	});

	it('drops null / undefined values in arrays', () => {
		const out = decomposeHeaderSet(
			JSON.stringify({ 'set-cookie': ['a=1', null, 'b=2'] }),
		);
		expect(out!.entryCount).toBe(2);
	});

	it('assigns unique occurrence ordinals when JSON has duplicate keys differing only in case', () => {
		// Non-conforming JSON that Object.entries iterates in insertion order.
		// Both keys lowercase to 'cookie'; without a per-name occurrence
		// counter, both would land at occurrence=1 and collide on the
		// header_set_entries composite PK.
		const raw = '{"Cookie":"a=1","cookie":["b=2","c=3"]}';
		const out = decomposeHeaderSet(raw);
		expect(out).not.toBeNull();
		const cookieEntries = out!.entries.filter((e) => e.name === 'cookie');
		expect(cookieEntries).toHaveLength(3);
		expect(cookieEntries.map((e) => e.occurrence)).toEqual([1, 2, 3]);
		expect(cookieEntries.map((e) => e.value)).toEqual(['a=1', 'b=2', 'c=3']);
	});

	it('skips non-string values instead of coercing to "[object Object]"', () => {
		const out = decomposeHeaderSet(
			JSON.stringify({
				'content-type': 'text/html',
				'x-bad-object': { nested: 'value' },
				'x-bad-number': 42,
				'x-bad-array': ['ok', { bad: 'x' }],
			}),
		);
		expect(out!.entryCount).toBe(2);
		const kept = out!.entries.map((e) => e.name);
		expect(kept.toSorted()).toEqual(['content-type', 'x-bad-array']);
	});
});
