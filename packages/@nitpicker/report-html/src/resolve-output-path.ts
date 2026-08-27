import path from 'node:path';

/**
 * Resolves the HTML destination, defaulting to the archive basename in CWD.
 * @param filePath - Source archive path.
 * @param outputPath - Explicit destination, when supplied.
 * @returns Absolute output path.
 * @example
 * resolveOutputPath('/tmp/site.nitpicker', undefined) // `${process.cwd()}/site.html`
 */
export function resolveOutputPath(filePath: string, outputPath?: string): string {
	if (outputPath) {
		return path.resolve(process.cwd(), outputPath);
	}
	const parsed = path.parse(filePath);
	return path.resolve(process.cwd(), `${parsed.name}.html`);
}
