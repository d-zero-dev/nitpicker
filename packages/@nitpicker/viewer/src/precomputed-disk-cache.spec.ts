import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOrComputeOnDisk } from './precomputed-disk-cache.js';

const baseDir = path.resolve(os.tmpdir(), `nitpicker-disk-cache-test-${process.pid}`);

beforeEach(async () => {
	await fs.rm(baseDir, { recursive: true, force: true });
	await fs.mkdir(baseDir, { recursive: true });
});

afterEach(async () => {
	await fs.rm(baseDir, { recursive: true, force: true });
});

describe('getOrComputeOnDisk', () => {
	it('computes and persists on cache miss, then returns parsed JSON on the next call without re-computing', async () => {
		// The whole point of the disk layer: viewer restarts reuse the
		// previous run's expensive compute. Verify by calling twice and
		// checking the compute fn fired only once.
		const cacheDir = path.join(baseDir, 'a');
		await fs.mkdir(cacheDir, { recursive: true });
		const compute = vi.fn().mockResolvedValueOnce({ greeting: 'hello' });

		const first = await getOrComputeOnDisk(cacheDir, 'sample', compute);
		const second = await getOrComputeOnDisk(cacheDir, 'sample', compute);

		expect(first).toEqual({ greeting: 'hello' });
		expect(second).toEqual({ greeting: 'hello' });
		expect(compute).toHaveBeenCalledTimes(1);

		// The artefact lives at the documented path.
		const onDisk = await fs.readFile(
			path.join(cacheDir, 'precomputed', 'sample.json'),
			'utf8',
		);
		expect(JSON.parse(onDisk)).toEqual({ greeting: 'hello' });
	});

	it('writes via a tmp sibling + rename so a reader never observes a half-written file', async () => {
		// We cannot easily inject a kill mid-write, so we observe the
		// fingerprint of the rename strategy: the final filename has no
		// `.tmp` suffix and there are no orphan `.tmp` files left after
		// a successful write.
		const cacheDir = path.join(baseDir, 'atomic');
		await fs.mkdir(cacheDir, { recursive: true });
		await getOrComputeOnDisk(cacheDir, 'atom', () => Promise.resolve({ ok: true }));
		const entries = await fs.readdir(path.join(cacheDir, 'precomputed'));
		expect(entries).toEqual(['atom.json']);
	});

	it('regenerates the artefact when the on-disk JSON is corrupt', async () => {
		// A previous viewer version may have written via a
		// non-atomic path that left a truncated file. The disk layer
		// must NOT block the viewer on stale corruption; it must treat
		// a parse failure as a cache miss and rewrite.
		const cacheDir = path.join(baseDir, 'corrupt');
		const precomputedDir = path.join(cacheDir, 'precomputed');
		await fs.mkdir(precomputedDir, { recursive: true });
		await fs.writeFile(path.join(precomputedDir, 'broken.json'), '{ not valid json');

		const compute = vi.fn().mockResolvedValueOnce({ healed: true });
		const result = await getOrComputeOnDisk(cacheDir, 'broken', compute);
		expect(result).toEqual({ healed: true });
		expect(compute).toHaveBeenCalledTimes(1);
		const onDisk = await fs.readFile(path.join(precomputedDir, 'broken.json'), 'utf8');
		expect(JSON.parse(onDisk)).toEqual({ healed: true });
	});

	it('still returns the computed value when the write fails (e.g. read-only cacheDir)', async () => {
		// Disk persistence is opportunistic — a permission error must
		// not propagate into the viewer's `/api/*` request path.
		const cacheDir = path.join(baseDir, 'readonly');
		await fs.mkdir(cacheDir, { recursive: true });
		await fs.chmod(cacheDir, 0o500); // r-x: cannot create precomputed/

		try {
			const result = await getOrComputeOnDisk(cacheDir, 'p', () =>
				Promise.resolve({ id: 7 }),
			);
			expect(result).toEqual({ id: 7 });
		} finally {
			await fs.chmod(cacheDir, 0o700);
		}
	});

	it('skips the write when the file already exists by the time we finish computing', async () => {
		// Concurrent-writer race: another viewer / MCP process may
		// have persisted the same artefact between our cache-miss
		// check and our write. We re-check existence before writing
		// and skip if a sibling beat us to it — both processes still
		// return the (deterministic) value, but disk I/O is avoided
		// and we do not stomp on the sibling's just-written file with
		// a redundant rename.
		const cacheDir = path.join(baseDir, 'race');
		const precomputedDir = path.join(cacheDir, 'precomputed');
		await fs.mkdir(precomputedDir, { recursive: true });
		// Pretend a sibling persisted a known artefact mid-compute.
		const siblingArtefact = '{"from":"sibling"}';
		await fs.writeFile(path.join(precomputedDir, 'shared.json'), siblingArtefact);
		// Tell the first read to fail (simulating "we lost the read
		// race" — sibling wrote AFTER our cache-miss check), so we
		// fall through to compute + re-check. We achieve this by
		// using a name whose file did NOT exist at the start of this
		// scope but DOES exist now — i.e. just use a fresh name and
		// pre-write the file ourselves.
		// Actually a cleaner setup: delete the file, start the call,
		// during compute the sibling writes — but we cannot easily
		// inject a mid-compute write. So we rely on the post-compute
		// re-check by:
		// 1. Removing the pre-written sibling file.
		// 2. Inside compute(), creating the file ourselves to
		//    simulate the race.
		await fs.unlink(path.join(precomputedDir, 'shared.json'));
		const result = await getOrComputeOnDisk(cacheDir, 'shared', async () => {
			// Simulate a sibling writing while we compute.
			await fs.writeFile(path.join(precomputedDir, 'shared.json'), siblingArtefact);
			return { from: 'us' };
		});
		expect(result).toEqual({ from: 'us' });
		// The sibling's artefact survived; we did NOT stomp it.
		const onDisk = await fs.readFile(path.join(precomputedDir, 'shared.json'), 'utf8');
		expect(onDisk).toBe(siblingArtefact);
	});

	it('reconstructs round-tripped Map shapes when callers serialise via entries arrays', async () => {
		// Map<K, V> is not natively JSON-serialisable; callers that cache a
		// Map serialise it as [[k,v],...] entries. Verify the disk layer
		// treats arbitrary JSON values opaquely so this pattern works.
		const cacheDir = path.join(baseDir, 'map');
		await fs.mkdir(cacheDir, { recursive: true });
		const entries: Array<[number, number]> = [
			[10, 3],
			[20, 5],
		];

		await getOrComputeOnDisk(cacheDir, 'm', () => Promise.resolve(entries));
		const second = await getOrComputeOnDisk<Array<[number, number]>>(cacheDir, 'm', () =>
			Promise.reject(new Error('should not re-compute')),
		);
		const reconstructed = new Map(second);
		expect(reconstructed.get(10)).toBe(3);
		expect(reconstructed.get(20)).toBe(5);
	});
});
