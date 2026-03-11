import type { ArchiveAccessor } from '@nitpicker/crawler';

import path from 'node:path';

import { Archive } from '@nitpicker/crawler';

/**
 * Manages the lifecycle of opened .nitpicker archive files.
 *
 * Tracks opened archives by a generated ID and provides
 * methods to open, retrieve, and close archive connections.
 * Each archive is extracted to a temporary directory and
 * connected via a read-only {@link ArchiveAccessor}.
 */
export class ArchiveManager {
	/** Map of archive IDs to their accessor and metadata. */
	readonly #archives = new Map<
		string,
		{
			/** The read-only accessor for querying the archive. */
			accessor: ArchiveAccessor;
			/** The temporary directory path used for extraction. */
			tmpDir: string;
		}
	>();

	/** Counter for generating unique archive IDs. */
	#nextId = 1;

	/**
	 * Closes an opened archive and releases its resources.
	 * @param archiveId - The archive ID to close.
	 * @throws {Error} If no archive with the given ID is found.
	 */
	close(archiveId: string) {
		const entry = this.#archives.get(archiveId);
		if (!entry) {
			throw new Error(`Archive not found: ${archiveId}.`);
		}
		this.#archives.delete(archiveId);
	}
	/**
	 * Closes all opened archives and releases all resources.
	 */
	closeAll() {
		const ids = [...this.#archives.keys()];
		for (const id of ids) {
			this.close(id);
		}
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
		const accessor = archive as ArchiveAccessor;
		this.#archives.set(archiveId, {
			accessor,
			tmpDir: archive.tmpDir,
		});
		return { archiveId, accessor, archive };
	}
}
