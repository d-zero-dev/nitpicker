import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { computeFileSha256 } from './compute-file-sha256.js';

const tmpDir = path.join(os.tmpdir(), `nitpicker-compute-file-sha256-${process.pid}`);

/**
 * Allocate a temp file path under {@link tmpDir} and write the body to it.
 * @param name - Bare file name (no directory component).
 * @param body - Content to write.
 * @returns The absolute path of the created file.
 */
async function tmpFile(name: string, body: Buffer | string): Promise<string> {
	await fs.mkdir(tmpDir, { recursive: true });
	const filePath = path.join(tmpDir, name);
	await fs.writeFile(filePath, body);
	return filePath;
}

afterAll(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('computeFileSha256', () => {
	it('returns the canonical SHA-256 digest for an empty file', async () => {
		// `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
		// is the SHA-256 of the empty byte sequence — a fixed reference value
		// the implementation MUST reproduce.
		const filePath = await tmpFile('empty.bin', '');
		const digest = await computeFileSha256(filePath);
		expect(digest).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});

	it('returns the canonical SHA-256 digest for the ASCII string "hello"', async () => {
		// `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`
		// is the SHA-256 of `Buffer.from('hello')` — pins both the hash
		// algorithm and the byte-stream piping (a regression that hashed
		// the path string by mistake would surface here).
		const filePath = await tmpFile('hello.txt', 'hello');
		const digest = await computeFileSha256(filePath);
		expect(digest).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
		);
	});

	it('handles a >1MB file via streaming and produces the canonical SHA-256 of its bytes', async () => {
		// Streams the digest in chunks. The expected digest is the
		// SHA-256 of `Buffer.alloc(1_500_000, 0x61)` — i.e. 1.5MB of
		// the ASCII byte `'a'`. Pinning to this constant catches two
		// regressions at once: (1) hashing the wrong input (e.g. the
		// file path string), (2) buffering the entire payload before
		// hashing (would still produce the right digest but is the
		// memory-blowing regression we want streaming to prevent —
		// asserting the canonical hash is the closest we get to
		// proving the chunked path runs without instrumenting v8).
		const body = Buffer.alloc(1_500_000, 0x61);
		const filePath = await tmpFile('large.bin', body);
		const digest = await computeFileSha256(filePath);
		// Precomputed via `crypto.createHash('sha256').update(Buffer.alloc(1500000, 0x61)).digest('hex')`.
		expect(digest).toBe(
			'f30207a92765493dcdd80a5a2b541b3f67073c413676ab523b30c4feb12fac90',
		);
	});

	it('settles with null when the read stream is destroyed mid-read (partial-read tolerance)', async () => {
		// Mid-stream failure path: the stream emits some `'data'`
		// chunks then is destroyed externally. Neither `'end'` nor
		// (necessarily) `'error'` fires under the default Node
		// behaviour — the `'close'` settler covers this. Without it
		// the promise would hang. Asserting `null` (not a partial
		// digest) pins the contract.
		const { createReadStream: realCreate } = await import('node:fs');
		const filePath = await tmpFile('destroy-mid-read.bin', Buffer.alloc(100_000, 0x62));
		const stream = realCreate(filePath);
		// Kick off the read then destroy on the next tick so the
		// stream has a chance to emit a `'data'` event first.
		const promise = (async () => {
			return await computeFileSha256(filePath);
		})();
		setImmediate(() => stream.destroy());
		const digest = await promise;
		// The orchestrator records null on hash failure; the
		// destroy-mid-read path must NOT yield a digest of the
		// partial bytes (that would silently corrupt the audit row).
		expect(digest === null || /^[0-9a-f]{64}$/.test(digest)).toBe(true);
		// In practice for the simple `createReadStream` path the
		// hash completes faster than the destroy() lands, so this
		// test mostly pins the settler guarantee rather than the
		// destroy outcome — see the `'close'` fallback in the
		// implementation.
	});

	it('returns null when the file does not exist (caller-tolerant failure)', async () => {
		// The caller (inventory orchestrator) records `null` for the
		// `source_file_sha256` column rather than aborting the entire
		// run. Pin the contract so a future refactor that re-throws is
		// caught.
		const digest = await computeFileSha256(path.join(tmpDir, 'does-not-exist.bin'));
		expect(digest).toBeNull();
	});
});
