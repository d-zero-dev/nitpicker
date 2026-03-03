import { Archive } from '@nitpicker/crawler';

import { archiveLog } from './debug.js';

/**
 * Opens a `.nitpicker` archive file and registers process signal handlers
 * to ensure the archive is closed gracefully on unexpected termination.
 * @param filePath - Path to the `.nitpicker` archive file
 * @returns The opened `Archive` instance with plugin data loaded
 */
export async function getArchive(filePath: string) {
	archiveLog('Open file: %s', filePath);
	const archive = await Archive.open({
		filePath,
		openPluginData: true,
	});
	archiveLog('File open succeeded');

	const close = async () => {
		await archive.close();
		process.exit();
	};

	archiveLog('Bind close method to SIGINT, SIGBREAK, SIGHUP, SIGABRT events');
	process.on('SIGINT', close);
	process.on('SIGBREAK', close);
	process.on('SIGHUP', close);
	process.on('SIGABRT', close);

	return archive;
}
