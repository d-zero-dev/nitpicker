import { Archive } from '@nitpicker/crawler';

import { archiveLog } from './debug.js';

/**
 * Result of opening an archive with signal handlers registered.
 *
 * Implements `Symbol.asyncDispose` so callers can obtain one via
 * `await using` instead of remembering to call both
 * `removeSignalHandlers()` and `archive.close()` by hand.
 */
export interface ArchiveHandle extends AsyncDisposable {
	/** The opened archive instance. */
	readonly archive: Archive;
	/** Removes the registered signal handlers. Call this when the archive is no longer in use. */
	readonly removeSignalHandlers: () => void;
}

/**
 * Opens a `.nitpicker` archive file and registers process signal handlers
 * to ensure the archive is closed gracefully on unexpected termination.
 *
 * The returned handle's `Symbol.asyncDispose` removes the signal handlers
 * and closes the archive together — prefer `await using` over calling
 * `removeSignalHandlers()` / `archive.close()` separately.
 * @param filePath - Path to the `.nitpicker` archive file
 * @returns An {@link ArchiveHandle} containing the archive and a cleanup function.
 */
export async function getArchive(filePath: string): Promise<ArchiveHandle> {
	archiveLog('Open file: %s', filePath);
	const archive = await Archive.open({
		filePath,
		openPluginData: true,
	});
	archiveLog('File open succeeded');

	const signals: NodeJS.Signals[] = ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGABRT'];

	const close = async () => {
		await archive.close();
		process.exit();
	};

	archiveLog('Bind close method to SIGINT, SIGBREAK, SIGHUP, SIGABRT events');
	for (const signal of signals) {
		process.on(signal, close);
	}

	const removeSignalHandlers = () => {
		for (const signal of signals) {
			process.removeListener(signal, close);
		}
	};

	return {
		archive,
		removeSignalHandlers,
		async [Symbol.asyncDispose]() {
			archiveLog('Closes file');
			removeSignalHandlers();
			await archive.close();
			archiveLog('Closed');
		},
	};
}
