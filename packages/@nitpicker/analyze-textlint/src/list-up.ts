/**
 * Standalone script that lints all HTML files in the current directory
 * for orthographic variant inconsistencies across an entire site.
 *
 * Unlike the main analyze-textlint plugin (which lints each page independently),
 * this script concatenates all pages into a single document before linting.
 * This enables cross-page rules like `ja-no-orthographic-variants` to detect
 * inconsistent word usage across different pages (e.g. using both "サーバー"
 * and "サーバ" on different pages of the same site).
 *
 * The output is deduplicated and written to `result.txt` for manual review.
 *
 * Usage: `npx tsx list-up.ts` (from the directory containing HTML files)
 */
import type { TextlintMessage } from '@textlint/types';

import fs from 'node:fs/promises';
import path from 'node:path';

import { glob } from 'glob';
import { JSDOM } from 'jsdom';
import { createLinter } from 'textlint';
import TurndownService from 'turndown';

const turndownService = new TurndownService();

const globPath = path.resolve(process.cwd(), '**', '*.html');
const files = await glob(globPath);

const pages = await Promise.all(
	files.map(async (filePath) => {
		let html = await fs.readFile(filePath, { encoding: 'utf8' });
		html = html.replaceAll(/\s+/g, ' ');
		const md = turndownService.turndown(html);

		const dom = new JSDOM(html);
		const title = dom.window.document.title;

		return `# ${title}\n\n${md}`;
	}),
);

const rulesConfig: Record<string, unknown> = {
	/**
	 * @see https://github.com/textlint-ja/textlint-rule-no-synonyms
	 */
	// '@textlint-ja/no-synonyms': true,
	'ja-no-orthographic-variants': true,
};

/**
 * Dynamically imports a module with CJS/ESM default-export interop.
 * See `index.ts#loadModule` for the detailed interop explanation.
 * @param moduleName - npm package name to import.
 * @returns The resolved module export.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadModule(moduleName: string): Promise<any> {
	const mod = await import(moduleName);
	return mod.default?.default ?? mod.default ?? mod;
}

const { TextlintKernelDescriptor } = await import('@textlint/kernel');

const ruleDescriptors = await Promise.all(
	Object.entries(rulesConfig)
		.filter(([, value]) => value !== false)
		.map(async ([ruleId, options]) => {
			const rule = await loadModule(`textlint-rule-${ruleId}`);
			return {
				ruleId,
				rule,
				options: options === true ? {} : (options as Record<string, unknown>),
			};
		}),
);

const descriptor = new TextlintKernelDescriptor({
	rules: ruleDescriptors,
	plugins: [],
	filterRules: [],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linter = createLinter({ descriptor: descriptor as any });

const result = await linter.lintText(pages.join('\n\n'), '.md');

const messages = result.messages.map((m: TextlintMessage) => m.message);

const resultSet = new Set(messages);

await fs.writeFile('result.txt', [...resultSet].join('\n'), { encoding: 'utf8' });
