import { promises as fs } from 'node:fs';

import { mkdir } from './mkdir.js';

/**
 * Writes raw bytes to a file at the specified path, creating parent
 * directories if needed.
 *
 * Unlike {@link outputText}, the buffer is written verbatim with no UTF-8
 * re-encoding, so callers that need byte-for-byte fidelity (e.g. archiving
 * a source file of unknown or mixed encoding for audit purposes) are not
 * exposed to lossy round-tripping through a JS string.
 * @param filePath - The absolute or relative path to the file to write.
 * @param data - The raw bytes to write.
 */
export async function outputBinary(filePath: string, data: Buffer) {
	mkdir(filePath);
	await fs.writeFile(filePath, data);
}
