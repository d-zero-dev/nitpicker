import type { ArchiveAccessor } from '@nitpicker/crawler';

import { accessSync, constants, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';

/** Maximum number of concurrently opened archives to prevent resource exhaustion. */
const MAX_OPEN_ARCHIVES = 20;

/**
 * Internal entry for a managed archive, shared across multiple IDs
 * that reference the same underlying file.
 */
interface SharedArchiveEntry {
	/** Close callback to release resources (delegates to Archive.close). */
	close: () => Promise<void>;
	/** The read-only accessor for querying the archive. */
	accessor: ArchiveAccessor;
	/** The temporary directory path used for extraction. */
	tmpDir: string;
	/** Number of archive IDs currently referencing this entry. */
	refCount: number;
}

/**
 * Manages the lifecycle of opened .nitpicker archive files.
 *
 * Tracks opened archives by a generated ID and provides
 * methods to open, retrieve, and close archive connections.
 * Each archive is extracted to a temporary directory and
 * connected via a read-only {@link ArchiveAccessor}.
 *
 * When the same file is opened multiple times, the existing extraction
 * is reused via reference counting — no redundant untar is performed.
 *
 * **Cleanup:** Calling {@link close} decrements the reference count.
 * The temporary directory and database connection are released only
 * when all references to the same file are closed.
 */
export class ArchiveManager {
	/** Map of archive IDs to the resolved file path they reference. */
	readonly #idToPath = new Map<string, string>();

	/** Counter for generating unique archive IDs. */
	#nextId = 1;
	/** Map of resolved file paths to their shared archive entry. */
	readonly #pathToEntry = new Map<string, SharedArchiveEntry>();

	/**
	 * Closes an opened archive reference. The underlying resources are
	 * released only when all references to the same file are closed.
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
		if (entry.refCount <= 0) {
			this.#pathToEntry.delete(realPath);
			try {
				await entry.close();
			} catch (error) {
				console.warn('Failed to close archive cleanly, forcing cleanup:', error);
				rmSync(entry.tmpDir, { recursive: true, force: true });
			}
		}
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
	 * Checks whether an archive with the given ID is currently open.
	 * @param archiveId - The archive ID to check.
	 * @returns `true` if the archive is open, `false` otherwise.
	 */
	has(archiveId: string): boolean {
		return this.#idToPath.has(archiveId);
	}

	/**
	 * Opens a .nitpicker archive file and returns an accessor for querying it.
	 *
	 * If the same file (by resolved real path) is already open, the existing
	 * extraction and database connection are reused — no redundant untar is
	 * performed. A new archive ID is issued that shares the underlying entry.
	 * @param filePath - The path to the .nitpicker archive file.
	 * @returns An object containing the generated archive ID and the accessor.
	 * @throws {Error} If the file does not have a .nitpicker extension.
	 * @throws {Error} If the maximum number of open archives is reached.
	 */
	async open(filePath: string) {
		if (!filePath.endsWith('.nitpicker')) {
			throw new Error('Invalid file type. Only .nitpicker archive files are supported.');
		}
		if (this.#pathToEntry.size >= MAX_OPEN_ARCHIVES) {
			throw new Error(
				`Too many open archives (max: ${MAX_OPEN_ARCHIVES}). Close unused archives first.`,
			);
		}
		const resolvedPath = path.resolve(filePath);
		try {
			accessSync(resolvedPath, constants.R_OK);
		} catch {
			throw new Error('Archive file not found or not readable.');
		}
		const realPath = realpathSync(resolvedPath);
		if (!realPath.endsWith('.nitpicker')) {
			throw new Error('Invalid file type. Only .nitpicker archive files are supported.');
		}

		const archiveId = `archive_${this.#nextId++}`;

		const existing = this.#pathToEntry.get(realPath);
		if (existing) {
			existing.refCount++;
			this.#idToPath.set(archiveId, realPath);
			return { archiveId, accessor: existing.accessor };
		}

		const archive = await Archive.open({
			filePath: realPath,
			openPluginData: true,
		});
		const accessor: ArchiveAccessor = archive;
		this.#pathToEntry.set(realPath, {
			close: () => archive.close(),
			accessor,
			tmpDir: archive.tmpDir,
			refCount: 1,
		});
		this.#idToPath.set(archiveId, realPath);
		return { archiveId, accessor, archive };
	}
}
