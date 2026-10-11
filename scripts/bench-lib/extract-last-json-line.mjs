/**
 * Parses the last non-empty line of a bench's stdout as its JSON record —
 * the bench contract keeps the record as the final stdout line, and
 * anything a dependency prints before it is ignored.
 * @param {string} stdout - Everything the bench wrote to stdout.
 * @returns {Record<string, unknown>} The record.
 * @throws {Error} When there is no non-empty line, or the last one is not a
 *   JSON object.
 * @example
 * extractLastJsonLine('noise\n{"bench":"body-hash"}\n'); // { bench: 'body-hash' }
 */
export function extractLastJsonLine(stdout) {
	const lastLine = stdout
		.split('\n')
		.map((line) => line.trim())
		.findLast((line) => line !== '');
	if (lastLine === undefined) {
		throw new Error('no output on stdout');
	}
	let value;
	try {
		value = JSON.parse(lastLine);
	} catch {
		throw new Error('the last stdout line is not JSON');
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('the last stdout line is not a JSON object');
	}
	return value;
}
