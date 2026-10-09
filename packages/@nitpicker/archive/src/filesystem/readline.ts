import { createReadStream } from 'node:fs';
import Readline from 'node:readline';

/**
 * Reads a file line by line and invokes the callback for each line.
 *
 * The callback may return a Promise for asynchronous processing.
 * All callback results are collected and awaited via `Promise.all` before returning.
 * @param filePath - The path to the file to read line by line.
 * @param callback - A function invoked for each line of the file.
 *   May return a Promise for asynchronous operations.
 * @returns A promise that resolves when all line callbacks have completed.
 */
export async function readline(
	filePath: string,
	callback: (line: string) => Promise<void> | void,
) {
	const stream = createReadStream(filePath);
	const rLine = Readline.createInterface(stream);
	const promiseBuffer: (Promise<void> | void)[] = [];
	await new Promise<void>((resolve) => {
		rLine.on('line', (line) => {
			promiseBuffer.push(callback(line));
		});
		rLine.on('close', () => {
			resolve();
		});
	});
	return Promise.all(promiseBuffer);
}
