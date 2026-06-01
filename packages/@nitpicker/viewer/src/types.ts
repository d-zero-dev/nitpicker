import type { ArchiveManager } from '@nitpicker/query';

/**
 * Options for launching the Viewer server.
 */
export interface ViewerOptions {
	/** Absolute or relative path to the `.nitpicker` archive to view. */
	filePath: string;
	/** Preferred port to listen on. Falls back to a free port if taken. Defaults to 4324. */
	port?: number;
	/** Hostname to bind to. Defaults to `localhost`. */
	host?: string;
	/** Whether to open the default browser automatically. Defaults to `true`. */
	open?: boolean;
}

/**
 * Runtime context holding the opened archive for the lifetime of the server.
 *
 * Holds the {@link ArchiveManager} and the issued archive ID rather than the
 * accessor directly, so routes resolve the accessor on demand via
 * `manager.get(archiveId)` without importing crawler-internal types.
 */
export interface ArchiveContext {
	/** The archive manager owning the opened archive. */
	manager: ArchiveManager;
	/** The archive ID issued by {@link ArchiveManager.open}. */
	archiveId: string;
	/** The resolved path of the opened archive (for display). */
	filePath: string;
}

/**
 * Options for `createApp`.
 */
export interface CreateAppOptions {
	/** The archive context to serve data from. */
	context: ArchiveContext;
	/** Absolute path to the directory containing the built frontend assets. */
	publicDir: string;
}
