import type { ConfigJSON } from '@nitpicker/types';

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Loads a nitpicker configuration JSON file from the given path.
 * Returns an empty object when no path is provided.
 * @param filePath - Absolute or relative path to the configuration file, or `null` to skip loading
 * @returns The parsed configuration object
 */
export async function loadConfig(filePath: string | null) {
	if (!filePath) {
		return {};
	}
	const absFilePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
	const data = await fs.readFile(absFilePath, { encoding: 'utf8' });
	return JSON.parse(data) as ConfigJSON;
}
