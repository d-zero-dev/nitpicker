import type { ArchiveMode } from './types.js';
import type { ArchiveAccessor, ArchiveLockHolder } from '@nitpicker/crawler';

import {
	accessSync,
	constants,
	existsSync,
	realpathSync,
	rmSync,
	statSync,
} from 'node:fs';
import path from 'node:path';

import {
	Archive,
	isArchiveCacheDisabled,
	peekArchiveLockHolder,
} from '@nitpicker/crawler';

/** Maximum number of concurrently opened archives to prevent resource exhaustion. */
const MAX_OPEN_ARCHIVES = 20;

/** Name of the SQLite database file inside an archive's tmpDir. */
const DB_FILE_NAME = 'db.sqlite';

/**
 * Result of {@link ArchiveManager.open}. The shape depends on the source
 * kind: archive-file opens additionally surface the underlying
 * {@link Archive} writer instance (for callers that want to take ownership
 * of finalisation, e.g. the orchestrator); stub opens never produce one.
 */
export interface OpenResult {
	/** Generated archive ID. */
	archiveId: string;
	/** Read-only accessor for query helpers. */
	accessor: ArchiveAccessor;
	/** Source kind that was detected. */
	mode: ArchiveMode;
	/**
	 * Lock-holder metadata when the source is a stub directory whose
	 * `.lock` sibling pointed at a live process at open time. `null` for
	 * archive-file opens and for stub opens whose lock is missing/stale.
	 *
	 * **Snapshot, not a subscription**: the value is captured exactly once
	 * at open time. The viewer / MCP server should treat it as a hint, not
	 * as a continuously-fresh status.
	 */
	crawlerLockHolder: ArchiveLockHolder | null;
	/** Underlying `Archive` instance — populated only for archive-file opens. */
	archive?: Archive;
}

/**
 * Internal entry for a managed archive, shared across multiple IDs
 * that reference the same underlying file or directory.
 */
interface SharedArchiveEntry {
	/** The read-only accessor for querying the archive. */
	accessor: ArchiveAccessor;
	/**
	 * Underlying `Archive` writer instance, populated only on the legacy
	 * (`NITPICKER_DISABLE_TAR_CACHE=1`) writer path. Surfaced through
	 * {@link OpenResult.archive} so the orchestrator can take ownership
	 * of finalisation when it goes through this manager. Always
	 * `undefined` on stub and cache modes.
	 */
	archive?: Archive;
	/**
	 * Resource-release callback invoked when refCount reaches 0. For
	 * archive mode this delegates to `Archive.close()` (writes the
	 * `.nitpicker`, removes tmpDir, releases lock, destroys DB). For stub
	 * mode it only calls `accessor.close()` — leaving the user's tmpDir
	 * intact for `crawl --resume`.
	 */
	close: () => Promise<void>;
	/**
	 * Cleanup-on-failure callback. Removes any filesystem state the
	 * manager itself owns; for stub mode this is a no-op because the
	 * tmpDir belongs to the crawler, not the manager. Keeping the policy
	 * on the entry means the manager's close path doesn't need to switch
	 * on `mode` — the closure already encodes "what's safe to remove".
	 */
	cleanupOnFailure: () => void;
	/**
	 * Promise of an in-flight close, if any. Set the moment a teardown
	 * starts so a concurrent `open()` on the same path can wait for the
	 * lock to be released before issuing a fresh `Archive.open()`.
	 */
	closing: Promise<void> | null;
	/** Snapshot of the lock holder at open time, surfaced through {@link OpenResult}. */
	crawlerLockHolder: ArchiveLockHolder | null;
	/** Whether this entry was opened from a finished archive file or a live tmpDir. */
	mode: ArchiveMode;
	/** Number of archive IDs currently referencing this entry. */
	refCount: number;
	/** The temporary directory path used for extraction. */
	tmpDir: string;
}

/**
 * Caller-supplied sink for the manager's user-facing warnings (e.g. "a
 * crawler appears to be running on this stub").
 *
 * Defaults to writing to `console.warn` so the viewer's stderr surfaces
 * the message. The MCP server should pass a no-op (or a structured
 * logger) so JSON-RPC stdio framing is never polluted by stray warn
 * lines and so the message can instead be returned to the LLM as part
 * of the tool response when that is the right channel.
 */
export type ArchiveManagerWarn = (message: string) => void;

/**
 * Options for {@link ArchiveManager}'s constructor.
 */
export interface ArchiveManagerOptions {
	/** Override the default `console.warn` sink. */
	onWarn?: ArchiveManagerWarn;
}

/**
 * Manages the lifecycle of opened archive sources.
 *
 * Tracks opened archives by a generated ID and provides
 * methods to open, retrieve, and close archive connections.
 * Accepts either a finished `.nitpicker` file (extracted into a fresh
 * tmpDir) or an in-progress crawl's tmpDir (read in place via
 * {@link Archive.connect}).
 *
 * When the same path is opened multiple times, the existing connection
 * is reused via reference counting — no redundant work is performed.
 *
 * **Cleanup safety:** Stub-mode entries close by only destroying the SQLite
 * handle. The tmpDir is **never** modified, removed, or zipped into a
 * `.nitpicker` file by the manager. This is what makes it safe to attach
 * to a crawl that the user intends to resume.
 *
 * **Warning routing:** All non-throwing diagnostics (e.g. detecting a live
 * crawler on a stub) flow through the {@link ArchiveManagerOptions.onWarn}
 * sink. Use this to suppress or redirect them when stdio is reserved for
 * structured framing (the MCP server).
 * @example
 * const manager = new ArchiveManager();
 * const { archiveId, accessor, mode } = await manager.open('./site.nitpicker');
 * const config = await accessor.getConfig();
 * // ... run query functions against `accessor` ...
 * await manager.close(archiveId); // or manager.closeAll()
 */
export class ArchiveManager {
	/** Map of archive IDs to the resolved canonical path they reference. */
	readonly #idToPath = new Map<string, string>();

	/** Counter for generating unique archive IDs. */
	#nextId = 1;
	/** Warning sink — defaults to `console.warn`. */
	readonly #onWarn: ArchiveManagerWarn;
	/**
	 * Promises for opens that are still in-flight, keyed by the resolved
	 * canonical path. A concurrent `open()` call on the same path awaits
	 * the in-flight promise instead of racing into a parallel
	 * `Archive.openCached` / `Archive.open` — without this guard, two
	 * callers can both create their own accessor for the same archive
	 * and the second `#pathToEntry.set` silently overwrites the first,
	 * leaking the loser's DB handle.
	 */
	readonly #openInflight = new Map<string, Promise<SharedArchiveEntry>>();

	/** Map of resolved canonical paths to their shared archive entry. */
	readonly #pathToEntry = new Map<string, SharedArchiveEntry>();

	/**
	 * @param options - Construction options.
	 * @param options.onWarn - Custom warning sink. Defaults to `console.warn`.
	 *   Pass a no-op to suppress diagnostic output (e.g. inside the MCP
	 *   server, where stderr is sometimes surfaced to the LLM client as
	 *   tool errors).
	 */
	constructor(options: ArchiveManagerOptions = {}) {
		this.#onWarn =
			options.onWarn ??
			((message) => {
				// eslint-disable-next-line no-console
				console.warn(message);
			});
	}

	/**
	 * Closes an opened archive reference. The underlying resources are
	 * released only when all references to the same path are closed.
	 *
	 * Concurrent-safe: a `open()` on the same path while a close is
	 * in-flight will await the close before issuing a fresh open, so the
	 * second caller never collides with the still-releasing lock.
	 * @param archiveId - The archive ID to close.
	 * @throws {Error} If no archive with the given ID is found.
	 */
	async close(archiveId: string) {
		const realPath = this.#idToPath.get(archiveId);
		if (!realPath) {
			throw new Error(`Archive not found: ${archiveId}.`);
		}
		this.#idToPath.delete(archiveId);

		const entry = this.#pathToEntry.get(realPath);
		if (!entry) {
			return;
		}
		entry.refCount--;
		if (entry.refCount > 0) {
			return;
		}
		if (entry.closing) {
			await entry.closing;
			return;
		}
		// Mark the entry as closing BEFORE awaiting so a concurrent
		// open() (or close()) can observe and wait. We only delete it
		// from the map after the close settles so the closing promise is
		// always reachable to racing callers.
		entry.closing = this.#tearDownEntry(realPath, entry);
		await entry.closing;
	}

	/**
	 * Closes all opened archives and releases all resources.
	 */
	async closeAll() {
		const ids = [...this.#idToPath.keys()];
		for (const id of ids) {
			await this.close(id);
		}
	}

	/**
	 * Retrieves the accessor for an opened archive by its ID.
	 * @param archiveId - The archive ID returned by {@link open}.
	 * @returns The {@link ArchiveAccessor} for the archive.
	 * @throws {Error} If no archive with the given ID is found.
	 */
	get(archiveId: string): ArchiveAccessor {
		const realPath = this.#idToPath.get(archiveId);
		if (!realPath) {
			throw new Error(
				`Archive not found: ${archiveId}. Use open_archive to load a .nitpicker file first.`,
			);
		}
		const entry = this.#pathToEntry.get(realPath);
		if (!entry) {
			throw new Error(
				`Archive not found: ${archiveId}. Use open_archive to load a .nitpicker file first.`,
			);
		}
		return entry.accessor;
	}

	/**
	 * Retrieves the crawler-lock snapshot taken at open time.
	 *
	 * Returns `null` when the source is a finished archive file or when no
	 * live lock holder was detectable at open. **Not** continuously
	 * refreshed — callers that need fresh state should call
	 * {@link peekArchiveLockHolder} themselves against the entry's tmpDir.
	 * @param archiveId - The archive ID returned by {@link open}.
	 */
	getCrawlerLockHolder(archiveId: string): ArchiveLockHolder | null {
		return this.#requireEntry(archiveId).crawlerLockHolder;
	}

	/**
	 * Checks whether an archive with the given ID is currently open.
	 * @param archiveId - The archive ID to check.
	 * @returns `true` if the archive is open, `false` otherwise.
	 */
	has(archiveId: string): boolean {
		return this.#idToPath.has(archiveId);
	}

	/**
	 * Opens an archive source and returns an accessor for querying it.
	 *
	 * Accepts either:
	 *
	 * - A `.nitpicker` archive file — extracted into a fresh tmpDir
	 *   ({@link Archive.open} path).
	 * - A directory containing a `db.sqlite` file — treated as an in-progress
	 *   crawl's tmpDir and read in place ({@link Archive.connect} path,
	 *   no lock, no extraction, no write-back on close).
	 *
	 * The directory case is the bridge between `crawl` and `crawl --resume`:
	 * a user who stops a crawl mid-flight can point the viewer at the leftover
	 * `._nitpicker-*` directory to inspect what was collected so far. The
	 * manager guarantees it will not zip or remove that directory on close.
	 *
	 * If the same path (by resolved real path) is already open, the existing
	 * connection is reused — no redundant work is performed. A new archive
	 * ID is issued that shares the underlying entry. A `open()` racing with
	 * an in-progress `close()` of the same path waits for the close to
	 * settle and then issues a fresh open, so a concurrent teardown does
	 * not surface as a spurious `ArchiveLockError`.
	 * @param filePath - The path to a `.nitpicker` file or a stub tmpDir.
	 * @returns An {@link OpenResult}.
	 * @throws {Error} If the path is neither a `.nitpicker` file nor a
	 *   directory containing `db.sqlite`.
	 * @throws {Error} If the path is not found or not readable.
	 * @throws {Error} If the maximum number of open archives is reached.
	 */
	async open(filePath: string): Promise<OpenResult> {
		if (this.#pathToEntry.size >= MAX_OPEN_ARCHIVES) {
			throw new Error(
				`Too many open archives (max: ${MAX_OPEN_ARCHIVES}). Close unused archives first.`,
			);
		}

		const resolvedPath = path.resolve(filePath);
		try {
			accessSync(resolvedPath, constants.R_OK);
		} catch {
			throw new Error('Archive path not found or not readable.');
		}
		let realPath: string;
		try {
			realPath = realpathSync(resolvedPath);
		} catch {
			throw new Error('Archive path not found or not readable.');
		}
		const mode = classifySource(filePath, realPath);

		// Wait out any in-flight close on this path before claiming the
		// entry — prevents racing the still-releasing lock.
		const inflightClose = this.#pathToEntry.get(realPath)?.closing;
		if (inflightClose) {
			await inflightClose;
		}

		const existing = this.#pathToEntry.get(realPath);
		if (existing && !existing.closing) {
			existing.refCount++;
			const archiveId = this.#issueId(realPath);
			// `archive` is intentionally NOT forwarded to refCount-shared
			// reuses: writer-mode lifecycle is owned by the caller that
			// triggered the initial open (the orchestrator), and a second
			// shared opener handing out the same writer would let either
			// caller close the underlying tmpDir under the other's feet.
			return {
				archiveId,
				accessor: existing.accessor,
				mode: existing.mode,
				crawlerLockHolder: existing.crawlerLockHolder,
			};
		}

		// Open dedup: serialise concurrent first-opens on the same path so
		// we never spawn two parallel `Archive.openCached` / `Archive.open`
		// calls that both land their own entry into `#pathToEntry`.
		const inflightOpen = this.#openInflight.get(realPath);
		if (inflightOpen) {
			const entry = await inflightOpen;
			entry.refCount++;
			const archiveId = this.#issueId(realPath);
			// Same writer-ownership rule as the cache-hit branch above:
			// only the caller that triggered the initial open receives
			// the writer instance.
			return {
				archiveId,
				accessor: entry.accessor,
				mode: entry.mode,
				crawlerLockHolder: entry.crawlerLockHolder,
			};
		}

		const openPromise = this.#performOpen(realPath, mode);
		this.#openInflight.set(realPath, openPromise);
		let entry: SharedArchiveEntry;
		try {
			entry = await openPromise;
		} finally {
			this.#openInflight.delete(realPath);
		}
		this.#pathToEntry.set(realPath, entry);
		const archiveId = this.#issueId(realPath);
		return {
			archiveId,
			accessor: entry.accessor,
			mode: entry.mode,
			crawlerLockHolder: entry.crawlerLockHolder,
			archive: entry.archive,
		};
	}

	/**
	 * Allocates and registers a new archive ID for the given canonical path.
	 * Centralised so a failed open does NOT burn the counter (the helper is
	 * only called after the entry is successfully registered).
	 * @param realPath - Resolved canonical path being registered.
	 */
	#issueId(realPath: string): string {
		const archiveId = `archive_${this.#nextId++}`;
		this.#idToPath.set(archiveId, realPath);
		return archiveId;
	}
	/**
	 * Run the mode-specific archive open. Pulled out of {@link open} so
	 * the concurrent-open dedup can hold a single Promise to it without
	 * the rest of the open() method having to live inside a closure.
	 *
	 * The returned entry has `refCount = 1` reserved for the caller that
	 * triggered the open. Concurrent waiters increment further when they
	 * resolve from `#openInflight`.
	 * @param realPath - Resolved canonical path of the archive.
	 * @param mode - Classified source kind (`'archive'` or `'stub'`).
	 */
	async #performOpen(realPath: string, mode: ArchiveMode): Promise<SharedArchiveEntry> {
		if (mode === 'stub') {
			const crawlerLockHolder = peekArchiveLockHolder(realPath);
			if (crawlerLockHolder?.alive) {
				this.#onWarn(
					`[nitpicker] Crawler appears to be running on this stub (PID ${crawlerLockHolder.pid}). Showing a read-only snapshot — data may be incomplete.`,
				);
			}
			const accessor = await Archive.connect(realPath);
			return {
				accessor,
				close: () => accessor.close(),
				cleanupOnFailure: () => {
					// Stub-mode tmpDir belongs to the live (or interrupted)
					// crawler. The manager never owns it and must never
					// remove it on failure.
				},
				closing: null,
				crawlerLockHolder,
				mode,
				refCount: 1,
				tmpDir: realPath,
			};
		}

		if (!isArchiveCacheDisabled()) {
			// Read-only path. The accessor returned by `Archive.openCached`
			// is backed by an OS-temp-scoped cache directory; closing it
			// only tears down the DB handle. The cache directory itself is
			// intentionally left in place so the next reader of the same
			// (unchanged) archive skips the untar. OS-level temp cleanup
			// reclaims stale entries — we do not own eviction here.
			const accessor = await Archive.openCached(realPath);
			// A read-only open never builds or writes anything — an on-open
			// opportunistic read-model build would mutate an archive the
			// viewer must treat as read-only (issue #177). Archives with a
			// missing or stale read model simply stay on the legacy query
			// path — `isViewerReadModelCurrent` is checked independently by
			// each endpoint's fast-path dispatcher, not here. The only build
			// paths are the crawl-completion hook and the explicit
			// `nitpicker viewer-build` command.
			return {
				accessor,
				close: () => accessor.close(),
				cleanupOnFailure: () => {
					// The cache directory is shared across processes; even
					// on a manager-side failure we must NOT remove it,
					// because another concurrent reader may still be using
					// it. Stale or half-populated entries are handled by
					// `extractArchiveToCache` at the next miss (it
					// quarantines half-extracted entries before
					// re-extracting when the ready marker is absent).
				},
				closing: null,
				crawlerLockHolder: null,
				mode,
				refCount: 1,
				tmpDir: accessor.tmpDir,
			};
		}

		// Known limitation: `cwd` is not forwarded here, so `Archive.open`
		// falls back to `process.cwd()` and materialises `tmpDir` /
		// `<tmpDir>.lock` next to the caller's cwd rather than next to the
		// archive file. In production this is harmless (the `finally` in
		// `Archive.#runFullClose` always releases the lock) but it makes the
		// writer path (`crawl --append` / `--retry-failed` invoked from an
		// unrelated directory) drop a `._nitpicker-<basename>` workspace into
		// the user's cwd for the duration of the run. Forwarding cwd here
		// (and exposing it on `ArchiveManager.open`) is the cleaner fix — out
		// of scope for the surrounding work.
		const archive = await Archive.open({ filePath: realPath, openPluginData: true });
		// Capture both `tmpDir` and `archive.renamedDir` so a partial-failure
		// rmSync recovery can clean either — `Archive.write()` renames the
		// tmpDir to `renamedDir` before tarring, and a `tar()` failure
		// after that point would leave `renamedDir` orphaned.
		const renamedDir = archive.renamedDir;
		return {
			accessor: archive,
			archive,
			close: () => archive.close(),
			cleanupOnFailure: () => {
				rmSync(archive.tmpDir, { recursive: true, force: true });
				rmSync(renamedDir, { recursive: true, force: true });
			},
			closing: null,
			crawlerLockHolder: null,
			mode,
			refCount: 1,
			tmpDir: archive.tmpDir,
		};
	}

	/**
	 * Resolves an archive ID to its entry or throws a uniform error.
	 * @param archiveId - The archive ID to look up.
	 */
	#requireEntry(archiveId: string): SharedArchiveEntry {
		const realPath = this.#idToPath.get(archiveId);
		const entry = realPath ? this.#pathToEntry.get(realPath) : undefined;
		if (!entry) {
			throw new Error(`Archive not found: ${archiveId}.`);
		}
		return entry;
	}

	/**
	 * Performs the actual teardown for an entry that has reached refCount=0:
	 * delegates to its `close` callback, on failure runs its
	 * `cleanupOnFailure` callback, then removes the entry from the path
	 * map regardless of outcome so a follow-up open can re-attempt.
	 *
	 * The `closing` promise on the entry is the synchronisation point for
	 * concurrent open() and close() callers — see {@link open}.
	 * @param realPath - The canonical path that keys the entry.
	 * @param entry - The entry to tear down.
	 */
	async #tearDownEntry(realPath: string, entry: SharedArchiveEntry): Promise<void> {
		try {
			await entry.close();
		} catch (error) {
			this.#onWarn(
				`Failed to close archive cleanly, forcing cleanup: ${stringifyError(error)}`,
			);
			try {
				entry.cleanupOnFailure();
			} catch (cleanupError) {
				this.#onWarn(`Cleanup-on-failure itself failed: ${stringifyError(cleanupError)}`);
			}
		} finally {
			this.#pathToEntry.delete(realPath);
		}
	}
}

/**
 * Coerce an arbitrary thrown value into a string for the warning sink.
 * Centralised so all warning lines have a uniform shape even when the
 * source threw a non-Error value (a common footgun with third-party
 * libraries).
 * @param error - The caught value.
 */
function stringifyError(error: unknown): string {
	if (error instanceof Error) {
		return error.stack ?? error.message;
	}
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

/**
 * Decide whether the resolved path points at a finished archive file or a
 * stub tmpDir. Centralises every validation rule so {@link ArchiveManager.open}
 * stays a thin dispatcher.
 *
 * Honors the **user's stated intent** encoded in the input path's
 * extension: a path that ends with `.nitpicker` is treated as an archive
 * file even if `realpathSync` resolves it to a directory (in which case we
 * throw a precise error rather than silently switching to stub mode and
 * skipping `openPluginData:true`). Likewise, a path that does not end with
 * `.nitpicker` is allowed to be a stub directory.
 * @param inputPath - The original user-supplied path (before realpath).
 * @param realPath - The realpath-resolved canonical path.
 * @returns The detected source kind.
 * @throws {Error} If the resolved target does not match the kind implied by
 *   the input extension, or if a directory lacks `db.sqlite`.
 */
function classifySource(inputPath: string, realPath: string): ArchiveMode {
	const inputLooksLikeArchiveFile = inputPath.endsWith('.nitpicker');
	let stat;
	try {
		stat = statSync(realPath);
	} catch {
		throw new Error('Archive path not found or not readable.');
	}

	if (inputLooksLikeArchiveFile) {
		if (stat.isDirectory()) {
			throw new Error(
				`Path "${inputPath}" looks like a .nitpicker archive file but resolves to a directory (${realPath}). ` +
					`If you meant to view a stub directory, pass the directory path without the .nitpicker extension.`,
			);
		}
		// The user's intent is "archive file"; if neither the input nor
		// the resolved target ends with `.nitpicker` we'd otherwise hand a
		// random file to `Archive.open()` and surface a confusing
		// TAR_BAD_ARCHIVE downstream. Catch it here with a precise message.
		if (!realPath.endsWith('.nitpicker')) {
			throw new Error(
				'Invalid path. Only .nitpicker archive files or stub directories (containing db.sqlite) are supported.',
			);
		}
		return 'archive';
	}

	if (stat.isDirectory()) {
		if (!existsSync(path.join(realPath, DB_FILE_NAME))) {
			throw new Error(
				`Directory does not look like a Nitpicker stub (missing ${DB_FILE_NAME}): ${realPath}`,
			);
		}
		return 'stub';
	}

	if (!realPath.endsWith('.nitpicker')) {
		throw new Error(
			'Invalid path. Only .nitpicker archive files or stub directories (containing db.sqlite) are supported.',
		);
	}
	return 'archive';
}
