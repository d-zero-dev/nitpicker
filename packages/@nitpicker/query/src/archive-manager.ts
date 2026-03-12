import type { ArchiveAccessor } from '@nitpicker/crawler';

import { rmSync } from 'node:fs';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';

/**
 * Internal entry for a managed archive.
 */
interface ArchiveEntry {
	/** Close callback to release resources (delegates to Archive.close). */
	close: () => Promise<void>;
	/** The read-only accessor for querying the archive. */
	accessor: ArchiveAccessor;
	/** The temporary directory path used for extraction. */
	tmpDir: string;
}

/**
 * Manages the lifecycle of opened .nitpicker archive files.
 *
 * Tracks opened archives by a generated ID and provides
 * methods to open, retrieve, and close archive connections.
 * Each archive is extracted to a temporary directory and
 * connected via a read-only {@link ArchiveAccessor}.
 *
 * **Cleanup:** Calling {@link close} removes the temporary directory
 * and destroys the database connection. Always close archives when done.
 */
export class ArchiveManager {
	/** Map of archive IDs to their managed entry. */
	readonly #archives = new Map<string, ArchiveEntry>();

	/** Counter for generating unique archive IDs. */
	#nextId = 1;

	/**
	 * Closes an opened archive, destroys the database connection,
	 * and removes the temporary directory.
	 * @param archiveId - The archive ID to close.
	 * @throws {Error} If no archive with the given ID is found.
	 */
	async close(archiveId: string) {
		const entry = this.#archives.get(archiveId);
		if (!entry) {
			throw new Error(`Archive not found: ${archiveId}.`);
		}
		this.#archives.delete(archiveId);
		try {
			await entry.close();
		} catch {
			// Archive.close() writes if file doesn't exist, then removes tmpDir.
			// If tmpDir was already removed or DB destroyed, clean up manually.
			rmSync(entry.tmpDir, { recursive: true, force: true });
		}
	}
	/**
	 * Closes all opened archives and releases all resources.
	 */
	async closeAll() {
		const ids = [...this.#archives.keys()];
		await Promise.all(ids.map((id) => this.close(id)));
	}
	/**
	 * Retrieves the accessor for an opened archive by its ID.
	 * @param archiveId - The archive ID returned by {@link open}.
	 * @returns The {@link ArchiveAccessor} for the archive.
	 * @throws {Error} If no archive with the given ID is found.
	 */
	get(archiveId: string): ArchiveAccessor {
		const entry = this.#archives.get(archiveId);
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
		return this.#archives.has(archiveId);
	}
	/**
	 * Opens a .nitpicker archive file and returns an accessor for querying it.
	 * The archive is extracted to a temporary directory and a read-only
	 * database connection is established.
	 * @param filePath - The path to the .nitpicker archive file.
	 * @returns An object containing the generated archive ID and the accessor.
	 */
	async open(filePath: string) {
		const resolvedPath = path.resolve(filePath);
		const archive = await Archive.open({
			filePath: resolvedPath,
			openPluginData: true,
		});
		const archiveId = `archive_${this.#nextId++}`;
		const accessor: ArchiveAccessor = archive;
		this.#archives.set(archiveId, {
			close: () => archive.close(),
			accessor,
			tmpDir: archive.tmpDir,
		});
		return { archiveId, accessor, archive };
	}
}
