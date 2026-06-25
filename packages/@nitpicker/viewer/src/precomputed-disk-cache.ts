import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Subdirectory inside an archive's tar-cache directory (PR #98) where
 * we persist precomputed read-only artefacts. Lives alongside the
 * extracted `db.sqlite` so that the archive's content-hash key (which
 * already covers `size + mtime + ctime + head/tail sha`) implicitly
 * invalidates these artefacts when the source archive changes — the
 * new content gets a new cacheDir.
 */
const PRECOMPUTED_DIR_NAME = 'precomputed';

/**
 * Load a precomputed artefact from disk if present, otherwise compute
 * it, persist to disk atomically, and return the result.
 *
 * **Why disk persistence on top of the in-memory `createPromiseLru`**:
 * the in-memory cache only survives the viewer process. The first
 * `/api/isolated-pages` / `/api/summary` / `/api/page-links` hit after
 * a viewer restart re-paid the 14-30 s SQL cost even though the
 * underlying archive hadn't changed. Persisting to disk extends the
 * cache lifetime to "until the archive's content key rolls" — i.e.
 * until the operator `crawl --append`s or otherwise mutates the
 * `.nitpicker`. Across viewer restarts (Ctrl-C, machine reboot, etc.)
 * the result is reused.
 *
 * Atomicity contract: the file is written to a `tmp` sibling first
 * (filename + `.${pid}.${counter}.tmp`) then `rename`d into place.
 * POSIX `rename(2)` is atomic on the same filesystem — a reader is
 * guaranteed to see either the previous file or the new file in full,
 * never a half-written truncation. The temp suffix carries the
 * writer's pid + an in-process counter so two concurrent processes
 * (and two concurrent in-process writers) never trample each other's
 * temp files. Last writer wins on the final filename — acceptable
 * because the artefacts are deterministic functions of the archive
 * content, so any winning version is correct.
 * @template T - The artefact type. Must be JSON-serialisable. The
 *   caller is responsible for round-trip safe shapes (e.g. `Map<K,V>`
 *   must be serialised as `[[k,v],…]` and deserialised through
 *   `new Map(arr)` — see `referrer-count-cache.ts` for the example).
 * @param cacheDir - Absolute path to the archive's tar-cache dir
 *   (taken from `accessor.tmpDir` on archive-mode opens). The
 *   precomputed artefact lives at
 *   `<cacheDir>/precomputed/<name>.json`.
 * @param name - Stable identifier for the artefact (e.g.
 *   `"isolated-clusters"`). Used as the on-disk filename.
 * @param compute - Loader invoked on cache miss. Its return value is
 *   what gets persisted; subsequent reads return the parsed JSON.
 * @returns The cached or freshly-computed artefact.
 */
export async function getOrComputeOnDisk<T>(
	cacheDir: string,
	name: string,
	compute: () => Promise<T>,
): Promise<T> {
	const dir = path.join(cacheDir, PRECOMPUTED_DIR_NAME);
	const file = path.join(dir, `${name}.json`);

	// Try a cache hit first. Distinguish "file does not exist" from
	// "file is corrupt": only the latter should trigger an OVERWRITE,
	// because corrupt content (e.g. a process killed mid-write under
	// some pre-atomic-rename code path) would otherwise be picked up
	// as cached by the "file exists → skip write" race protection
	// below and never repair itself.
	let isCorrupt = false;
	try {
		const raw = await fs.readFile(file, 'utf8');
		return JSON.parse(raw) as T;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== 'ENOENT') {
			// Either an ENOENT we did not anticipate (handled below by
			// treating as miss) or a parse error — both fall through
			// to compute. We only flag corruption when the file was
			// reachable but the JSON did not parse, so the post-compute
			// race-check overwrites the bad data.
			isCorrupt = !code; // SyntaxError has no .code
		}
	}

	const value = await compute();

	if (!isCorrupt) {
		try {
			// Concurrent-writer skip: between the cache-miss check above
			// and now, a sibling process (another viewer, MCP, or
			// query CLI on the same archive) may have computed and
			// persisted the same artefact. Re-check existence — if the
			// file appeared while we were computing, leave the
			// existing copy alone. Artefacts are deterministic
			// functions of the archive content so their copy is
			// identical to ours; skipping the write avoids redundant
			// disk I/O and matches the "if it already exists, don't
			// write" intent. Skipped only when we did NOT see a
			// corrupt file on the read attempt — corruption recovery
			// must overwrite.
			await fs.access(file);
			return value;
		} catch {
			// Still missing, continue to the atomic write.
		}
	}

	try {
		await fs.mkdir(dir, { recursive: true });
		const tmp = path.join(dir, `${name}.${process.pid}.${nextCounter()}.tmp`);
		await fs.writeFile(tmp, JSON.stringify(value), 'utf8');
		await fs.rename(tmp, file);
	} catch {
		// Failure to persist is non-fatal: the in-memory cache layer
		// still serves the value for this viewer session. Next start
		// will pay the compute cost again, which is the pre-disk-cache
		// baseline — strictly no worse.
	}

	return value;
}

/**
 * In-process counter appended to the temp filename so two concurrent
 * `getOrComputeOnDisk` calls in the same process do not collide on
 * the temp name (and so the rename target races resolve cleanly).
 */
let counter = 0;

/**
 * Issue the next temp-filename sequence number.
 * @returns A monotonically increasing non-negative integer per process.
 */
function nextCounter(): number {
	counter = (counter + 1) % 0x1_00_00_00_00;
	return counter;
}
