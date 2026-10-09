import { promises as fs } from 'node:fs';
import path from 'node:path';

import { mkdir } from './mkdir.js';

let filePathTooLongCount = 0;

/**
 * Writes text data to a file at the specified path.
 *
 * Creates parent directories if they do not exist.
 * If the file path exceeds the OS limit (ENAMETOOLONG), the file is saved
 * with an auto-generated short name and an accompanying `.meta.txt` file
 * that records the original file path.
 * @param filePath - The absolute or relative path to the text file to write.
 * @param data - The text content to write to the file.
 */
export async function outputText(filePath: string, data: string) {
	mkdir(filePath);
	await fs.writeFile(filePath, data, { encoding: 'utf8' }).catch(async (error) => {
		if (error instanceof Error && 'code' in error && error.code === 'ENAMETOOLONG') {
			// eslint-disable-next-line no-console
			console.error(`File path too long: ${filePath}`);
			const dir = path.dirname(filePath);
			const altFileName = `__file_path_too_long_${(filePathTooLongCount++).toString().padStart(4, '0')}`;
			const ext = path.extname(filePath);
			const altFilePath = path.resolve(dir, `${altFileName}${ext}`);
			// eslint-disable-next-line no-console
			console.error(`Try to save to: ${altFilePath}`);
			const altMetaFilePath = path.resolve(dir, `${altFileName}.meta.txt`);
			await outputText(altFilePath, data);
			await outputText(altMetaFilePath, `Original file path: ${filePath}`);
		}
	});
}
