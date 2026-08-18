import fs from 'node:fs/promises';
import path from 'node:path';

import { acquireArchiveLock, ArchiveLockError } from '../archive-lock.js';
import { Database } from '../database.js';
import { peekTarTopDir } from '../filesystem/peek-tar-top-dir.js';
import { rename } from '../filesystem/rename.js';
import { untar } from '../filesystem/untar.js';
import { IncompatibleArchiveError } from '../meta/types.js';

import { computeArchiveCacheKey } from './compute-archive-cache-key.js';

/**
 * How long {@link extractArchiveToCache} waits in total for a peer
 * extractor to finish (ms). 5 minutes is enough for the largest archives
 * the crawler currently produces (~10 GB untars in ~10 s; 5 min gives
 * 30× headroom) while still bounded so a deadlocked process eventually
 * surfaces as a real error instead of hanging the viewer indefinitely.
 */
const PEER_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Polling interval while waiting on a peer extractor (ms). Short enough
 * to keep latency low when the peer is fast, long enough to avoid
 * burning CPU on a busy `fs.stat` loop.
 */
const PEER_WAIT_POLL_MS = 50;

/**
 * Marker file dropped into a cache directory only after the extraction
 * has fully completed AND the contents have passed a structural sanity
 * check (db.sqlite present, schema compatible, migrations applied).
 *
 * Internal — the file name is an implementation detail. Tests should
 * assert through externally observable behaviour (cache hit on second
 * open) rather than importing this constant.
 */
const READY_MARKER = '.nitpicker-cache-ready';

/**
 * In-process deduplication for concurrent {@link extractArchiveToCache}
 * calls targeting the same `cacheDir`.
 *
 * The file-based {@link acquireArchiveLock} (mkdir-based) cannot defend
 * against same-process race windows because the lock holder writes its
 * `pid.txt` in a separate `await` from the directory creation: a sibling
 * promise that observes the `EEXIST` between those two steps sees an
 * empty `pid.txt`, mistakes the lock for stale, and clobbers it.
 *
 * Single-process dedup eliminates that race entirely for the common
 * "viewer + MCP in the same process" topology while still letting the
 * inner file lock guard cross-process collisions.
 */
const inFlightByCacheDir = new Map<string, Promise<void>>();

/**
 * Untar a `.nitpicker` archive into the given cache directory.
 *
 * Concurrency / re-entry contract:
 *
 * - Two viewers opening the same archive race for the cache lock; the
 *   loser waits and recheck-loops until the winner writes the ready
 *   marker, then short-circuits.
 * - Same-process concurrent callers dedupe through
 *   `inFlightByCacheDir` so they share one extraction promise.
 *
 * Per-archive staging:
 *
 * - The tar's inner directory is extracted into `${cacheDir}.staging/`
 *   first, then atomically renamed into `cacheDir`. Crucially, the
 *   staging path is keyed off `cacheDir` (not the tar's inner directory
 *   name) so two archives that happen to share an inner-dir name never
 *   collide on the same staging slot.
 *
 * Integrity guard:
 *
 * - After rename, we run the writer-side `Database.connect` so all
 *   migrations apply (column adds, new tables) and the version check
 *   fires before the ready marker is written. A corrupt or incompatible
 *   archive therefore poisons no cache entry — the cacheDir is removed
 *   and the next caller retries from scratch.
 *
 * TOCTOU guard:
 *
 * - The cache key is recomputed from the file's stat AFTER the untar
 *   completes. If the file changed mid-flight (a concurrent
 *   `crawl --append` rewrote it), the freshly-landed cache contents do
 *   not correspond to the original key, so we abort and remove the
 *   cacheDir so the caller upstream sees the inconsistency rather than
 *   serving misattributed data.
 * @param archivePath - Absolute path to the source `.nitpicker` file.
 * @param cacheRoot - Absolute path to the cache root directory.
 * @param cacheDir - Absolute path the extracted contents should end up at.
 * @param cacheKey - The cache key used to derive `cacheDir`. Recomputed
 *   after extraction to detect concurrent writers; must match.
 * @param onExtractProgress - Called during the untar step with bytes read
 *   so far and the archive's total size (issue #294: a cold cache on a
 *   large archive can take tens of seconds with no other signal it isn't
 *   hung). Never called on a cache hit — {@link isCacheDirReady} short-
 *   circuits before `untar` runs — so callers can treat "never invoked" as
 *   the definition of a hit and skip printing a phase label until the
 *   first call actually arrives. Only the first concurrent caller for a
 *   given `cacheDir` sees callbacks; same-`cacheDir` callers deduped
 *   through {@link inFlightByCacheDir} just await the shared promise.
 * @returns Resolves once `cacheDir` is ready to be opened read-only.
 */
export async function extractArchiveToCache(
	archivePath: string,
	cacheRoot: string,
	cacheDir: string,
	cacheKey: string,
	onExtractProgress?: (readBytes: number, totalBytes: number) => void,
): Promise<void> {
	if (await isCacheDirReady(cacheDir)) {
		return;
	}

	const existing = inFlightByCacheDir.get(cacheDir);
	if (existing) {
		return existing;
	}

	const promise = runExtraction(
		archivePath,
		cacheRoot,
		cacheDir,
		cacheKey,
		onExtractProgress,
	).finally(() => {
		inFlightByCacheDir.delete(cacheDir);
	});
	inFlightByCacheDir.set(cacheDir, promise);
	return promise;
}

/**
 * The actual extraction work. Split out from {@link extractArchiveToCache}
 * so the in-process dedup map can wrap it without disturbing the
 * extraction flow itself.
 * @param archivePath - Absolute path to the source `.nitpicker` file.
 * @param cacheRoot - Absolute path to the cache root directory.
 * @param cacheDir - Absolute path the extracted contents should end up at.
 * @param cacheKey - Pre-extraction cache key, re-verified post-extraction.
 * @param onExtractProgress - See {@link extractArchiveToCache}.
 */
async function runExtraction(
	archivePath: string,
	cacheRoot: string,
	cacheDir: string,
	cacheKey: string,
	onExtractProgress?: (readBytes: number, totalBytes: number) => void,
): Promise<void> {
	await fs.mkdir(cacheRoot, { recursive: true });

	const releaseLock = await acquireLockWithPeerWait(cacheDir);
	try {
		if (await isCacheDirReady(cacheDir)) {
			return;
		}

		// Half-populated cacheDir recovery: another extractor crashed
		// before writing the marker. Rename it aside instead of `rm`-ing
		// in place so any reader that somehow still holds an fd on the
		// old contents (the cache layer doesn't refcount readers) is not
		// pulled out from under. The renamed quarantine dir is left for
		// OS-level temp cleanup.
		await quarantineHalfPopulatedCacheDir(cacheDir);

		const stagingDir = `${cacheDir}.staging`;
		// Stage clean: a previous crashed run may have left
		// `<cacheDir>.staging/` around. `untar` would happily merge into
		// it (with `newer:true` cherrypicking entries) so wipe first.
		await fs.rm(stagingDir, { recursive: true, force: true });
		await fs.mkdir(stagingDir, { recursive: true });

		await untar(archivePath, { cwd: stagingDir, onProgress: onExtractProgress });

		// Concurrent-writer detection: if the source archive changed
		// during our untar, the contents we just landed do NOT match the
		// `cacheKey` that named the directory. Drop the staging dir and
		// surface as an error so the caller (or a retry) can pick up the
		// new key.
		const postKey = await computeArchiveCacheKey(archivePath);
		if (postKey !== cacheKey) {
			await fs.rm(stagingDir, { recursive: true, force: true });
			throw new Error(
				`Archive changed during cache extraction (key ${cacheKey} -> ${postKey}); ` +
					`refusing to land mismatched contents at ${cacheDir}.`,
			);
		}

		const innerDirName = await peekTarTopDir(archivePath);
		const extractedInner = path.resolve(stagingDir, innerDirName);
		// Move the inner directory into the cache slot. Any old quarantine
		// is already aside, so the target is guaranteed empty.
		await rename(extractedInner, cacheDir, true);
		// The empty `stagingDir` wrapper is no longer useful — best effort
		// remove (ignore errors, OS cleanup catches stragglers).
		await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});

		// Validate + migrate: open in WRITER mode so the full migration
		// stack runs (initSchema / migrate*). On failure (db.sqlite
		// missing, incompatible archive, broken schema), tear down the
		// cache entry so the next caller does not get stuck on a
		// "ready"-marked but broken cache.
		try {
			await runMigrationsOnCacheDir(cacheDir);
		} catch (error) {
			await fs.rm(cacheDir, { recursive: true, force: true });
			throw error;
		}

		await fs.writeFile(path.join(cacheDir, READY_MARKER), '', 'utf8');
	} finally {
		await releaseLock();
	}
}

/**
 * Acquire the cache lock, blocking until any peer extractor finishes
 * (rather than failing fast on `EEXIST` the way the writer-oriented
 * {@link acquireArchiveLock} does). Returns the release function once
 * the lock is held.
 * @param cacheDir - Absolute path the lock guards.
 */
async function acquireLockWithPeerWait(cacheDir: string): Promise<() => Promise<void>> {
	const startedAt = Date.now();
	while (true) {
		if (await isCacheDirReady(cacheDir)) {
			// Peer finished and the marker is up. Return a no-op release
			// so the caller can `finally`-await it without branching.
			return async () => {};
		}
		try {
			return await acquireArchiveLock(cacheDir);
		} catch (error) {
			if (!(error instanceof ArchiveLockError)) {
				throw error;
			}
			if (Date.now() - startedAt > PEER_WAIT_TIMEOUT_MS) {
				throw error;
			}
			await sleep(PEER_WAIT_POLL_MS);
		}
	}
}

/**
 * Open the migrated DB in writer mode so all migrations apply, then
 * release the handle. Cache entries land migrated, so the subsequent
 * `Archive.connect` read-only open never needs to mutate the cache dir
 * (and never silently misses a newly-added column).
 * @param cacheDir - Absolute path to the freshly-extracted cache dir.
 */
async function runMigrationsOnCacheDir(cacheDir: string): Promise<void> {
	const dbPath = path.join(cacheDir, 'db.sqlite');
	if (!(await fileExists(dbPath))) {
		throw new Error(`Cache directory does not contain db.sqlite: ${cacheDir}`);
	}
	const db = await Database.connect({ filename: dbPath, readOnly: false });
	try {
		// `Database.connect` ran migrations during init. Closing here
		// flushes WAL + drops the handle so the read-only re-open in
		// `Archive.connect` does not race the writer connection.
		await db.destroy();
	} catch (error) {
		// Propagate after attempting cleanup of the connection (best
		// effort — the cache dir tear-down happens in the caller).
		if (error instanceof IncompatibleArchiveError) {
			throw error;
		}
		throw error;
	}
}

/**
 * Move a half-populated cacheDir aside so the next extraction can land
 * cleanly without yanking live readers' files out from under them. The
 * quarantine path gets a unique suffix so two crashes in succession
 * don't collide.
 * @param cacheDir - Absolute path of the cache slot to free.
 */
async function quarantineHalfPopulatedCacheDir(cacheDir: string): Promise<void> {
	try {
		await fs.access(cacheDir);
	} catch {
		// Nothing to quarantine.
		return;
	}
	if (await isCacheDirReady(cacheDir)) {
		// Already settled — caller will short-circuit, no quarantine needed.
		return;
	}
	const quarantinePath = `${cacheDir}.corrupt.${process.pid}.${nextQuarantineCounter()}`;
	try {
		await fs.rename(cacheDir, quarantinePath);
	} catch {
		// If rename fails (e.g. cross-volume), fall back to direct
		// removal — accepting the rm-while-reader risk this single time
		// since we have no other option.
		await fs.rm(cacheDir, { recursive: true, force: true });
	}
}

/**
 * Monotonic counter appended to quarantine directory names so multiple
 * recoveries in a single process never collide on the same path. Resets
 * to zero after `2 ** 32` increments; that bound is far larger than any
 * realistic per-process quarantine count.
 */
let quarantineCounter = 0;

/**
 * Issue the next quarantine sequence number.
 * @returns A non-negative integer, monotonically increasing per process.
 */
function nextQuarantineCounter(): number {
	quarantineCounter = (quarantineCounter + 1) % 0x1_00_00_00_00;
	return quarantineCounter;
}

/**
 * Async existence probe — avoids blocking the event loop on the warm
 * cache-hit fast path.
 * @param targetPath - Absolute path to probe.
 * @returns `true` if the path is reachable via `fs.access`.
 */
async function fileExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Whether a cache directory contains a fully-validated extraction. The
 * READY marker is the only trustworthy signal — sibling files alone
 * cannot be trusted because a half-extracted dir can also contain a
 * `db.sqlite`.
 * @param cacheDir - Absolute path to a candidate cache directory.
 * @returns `true` if the marker exists.
 */
async function isCacheDirReady(cacheDir: string): Promise<boolean> {
	return await fileExists(path.join(cacheDir, READY_MARKER));
}

/**
 * Promise-based sleep used by the peer-wait poll. Kept inline so the
 * file has no external sleep dependency and so the implementation can
 * later swap for an AbortSignal-aware version without touching the
 * call site.
 * @param ms - Milliseconds to wait.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
