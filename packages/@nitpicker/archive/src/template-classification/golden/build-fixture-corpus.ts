import type { PageClusterSignals } from '../page-cluster/resolve-page-cluster-keys.js';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Turns the page-cluster HTML fixtures (`page-cluster/__fixtures__/`) into
 * one corpus for the golden test. The pages are unrelated to each other, so
 * the corpus contributes little clustering structure; what it adds is
 * real-world markup (CMS themes, frameworks, multilingual and adversarial
 * pages) for the HTML parser, tokenization and the landmark / depth-cap
 * passes. Each page
 * is keyed by its directory and file name, with no stylesheets, so Pass 0
 * blocks the corpus by directory.
 * @param fixturesDir - Absolute path of `page-cluster/__fixtures__/`.
 * @returns One page per `.html` file, sorted by relative path.
 * @example
 * ```ts
 * const pages = buildFixtureCorpus(path.join(engineDir, '__fixtures__'));
 * ```
 */
export function buildFixtureCorpus(fixturesDir: string): PageClusterSignals[] {
	return readdirSync(fixturesDir, { recursive: true, encoding: 'utf8' })
		.filter((relativePath) => relativePath.endsWith('.html'))
		.map((relativePath) => relativePath.split(path.sep).join('/'))
		.toSorted()
		.map((relativePath) => {
			const segments = relativePath.split('/');
			return {
				// `production-scale/<category>/<file>` → `<category>/<file>`; the
				// shared top directory would otherwise put every page in one block.
				paths: segments[0] === 'production-scale' ? segments.slice(1) : segments,
				stylesheetHrefs: [],
				html: readFileSync(path.join(fixturesDir, relativePath), 'utf8'),
				host: 'golden.example',
			};
		});
}
