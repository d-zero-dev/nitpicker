/**
 * Parses and validates a dump written by `template-classification-golden.mjs dump`.
 * `check` calls this before classifying, so a wrong path or a foreign file
 * fails in a second instead of after a classification that can take many
 * minutes on a large archive.
 * @param {string} text - The file contents.
 * @returns {{ node?: string; classifiedPageCount: number; templateKeyByUrl: Record<string, string>; clusterReasonJsonByTemplateKey: Record<string, string> }}
 *   The dump.
 * @throws {Error} When the text is not JSON or lacks a field.
 * @example
 * const golden = parseGoldenDump(await readFile(goldenPath, 'utf8'));
 */
export function parseGoldenDump(text) {
	const dump = JSON.parse(text);
	if (
		typeof dump?.classifiedPageCount !== 'number' ||
		!isStringRecord(dump.templateKeyByUrl) ||
		!isStringRecord(dump.clusterReasonJsonByTemplateKey)
	) {
		throw new Error(
			'Not a template-classification golden dump: expected classifiedPageCount, templateKeyByUrl and clusterReasonJsonByTemplateKey',
		);
	}
	return dump;
}

/**
 * @param {unknown} value - Anything.
 * @returns {boolean} Whether it is a plain object of string values.
 */
function isStringRecord(value) {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === 'string')
	);
}
