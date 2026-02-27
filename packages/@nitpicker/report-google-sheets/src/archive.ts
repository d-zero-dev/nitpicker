import { Archive } from '@nitpicker/crawler';

import { archiveLog } from './debug.js';

/**
 *
 * @param filePath
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
