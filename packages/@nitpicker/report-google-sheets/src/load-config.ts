import type { ConfigJSON } from '@nitpicker/types';

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 *
 * @param filePath
 */
export async function loadConfig(filePath: string | null) {
	if (!filePath) {
		return {};
	}
	const absFilePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
	const data = await fs.readFile(absFilePath, { encoding: 'utf8' });
	return JSON.parse(data) as ConfigJSON;
}
