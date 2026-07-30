import type { QuerySubCommand } from '../query/types.js';
import type { CommandDef, InferFlags } from '@d-zero/roar';

import path from 'node:path';

import { ArchiveManager } from '@nitpicker/query';

import { formatCliError } from '../format-cli-error.js';
import { dispatchQuery } from '../query/dispatch-query.js';
import { VALID_SUB_COMMANDS } from '../query/types.js';

/**
 * Command definition for the `query` sub-command.
 * @see {@link query} for the main entry point
 */
export const commandDef = {
	desc: 'Query a .nitpicker archive',
	flags: {
		limit: {
			type: 'number',
			shortFlag: 'l',
			desc: 'Maximum number of results to return',
		},
		offset: {
			type: 'number',
			shortFlag: 'o',
			desc: 'Number of results to skip',
		},
		cursor: {
			type: 'string',
			desc: 'Opaque pagination cursor from a previous result (resource-referrers, inbound-links, duplicates, mismatches)',
		},
		direction: {
			type: 'string',
			desc: 'Direction to walk from --cursor: next (default) or prev (inbound-links, duplicates, mismatches)',
		},
		pagesLimit: {
			type: 'number',
			desc: 'Inline member-page URL sample size per duplicate group (duplicates), or per body-hash cluster (duplicate-clusters). Defaults to 20.',
		},
		minCount: {
			type: 'number',
			desc: 'Minimum cluster size to include (duplicate-clusters). Defaults to 10.',
		},
		url: {
			type: 'string',
			desc: 'Target URL for page-detail, inbound-links, html, resource-referrers, or page-console-logs queries',
		},
		status: {
			type: 'number',
			desc: 'Filter by exact HTTP status code',
		},
		statusMin: {
			type: 'number',
			desc: 'Filter by minimum HTTP status code (inclusive)',
		},
		statusMax: {
			type: 'number',
			desc: 'Filter by maximum HTTP status code (inclusive)',
		},
		isExternal: {
			type: 'boolean',
			desc: 'Filter by external (true) or internal (false)',
		},
		missingTitle: {
			type: 'boolean',
			desc: 'Filter to pages missing title',
		},
		missingDescription: {
			type: 'boolean',
			desc: 'Filter to pages missing description',
		},
		noindex: {
			type: 'boolean',
			desc: 'Filter to pages with noindex',
		},
		urlPattern: {
			type: 'string',
			desc: 'URL pattern to filter (SQL LIKE pattern)',
		},
		directory: {
			type: 'string',
			desc: 'Directory path prefix to filter by',
		},
		sortBy: {
			type: 'string',
			desc: 'Field to sort by (url, status, title for pages; totalCount, pageCount, text, type for console-logs)',
		},
		sortOrder: {
			type: 'string',
			desc: 'Sort direction (asc, desc)',
		},
		type: {
			type: 'string',
			desc: 'Filter type: broken, external (links); canonical, og:title, og:description (mismatches); or a console message type e.g. error, warn, pageerror (console-logs)',
		},
		contentType: {
			type: 'string',
			desc: 'Filter by content type prefix (e.g. text/css)',
		},
		contentTypeCategory: {
			type: 'string',
			desc: 'Filter pages by Content-Type category (html, pdf, csv, word, excel, powerpoint, image, css, javascript, json, xml, font, audio, video, archive, text, other, unknown)',
		},
		missingAlt: {
			type: 'boolean',
			desc: 'Filter to images missing alt attribute',
		},
		missingDimensions: {
			type: 'boolean',
			desc: 'Filter to images missing width/height',
		},
		oversizedThreshold: {
			type: 'number',
			desc: 'Filter to images exceeding this dimension threshold',
		},
		validator: {
			type: 'string',
			desc: 'Filter by validator name (e.g. axe, markuplint)',
		},
		severity: {
			type: 'string',
			desc: 'Filter by severity level',
		},
		rule: {
			type: 'string',
			desc: 'Filter by rule ID',
		},
		field: {
			type: 'string',
			desc: 'Field to check for duplicates (title, description)',
		},
		missingOnly: {
			type: 'boolean',
			desc: 'Only show pages missing security headers',
		},
		maxLength: {
			type: 'number',
			desc: 'Maximum HTML length to return',
		},
		provider: {
			type: 'string',
			desc: 'Wappalyzer provider name (for pages-by-tag, count-pages-by-tag)',
		},
		externalId: {
			type: 'string',
			desc: 'External identifier (GTM-XXXX / G-XXXX / …) for pages-by-tag, count-pages-by-tag',
		},
		full: {
			type: 'boolean',
			desc: 'Return full raw JSON-LD (page-jsonld). Default is slim (no raw / parsed).',
		},
		representativeUrl: {
			type: 'string',
			desc: 'Representative URL of an isolated cluster (get-isolated-cluster); obtain via `query <archive> isolated-clusters`.',
		},
		includeRedirectSources: {
			type: 'boolean',
			desc: 'Include redirect-source rows / disable redirect resolution. Diagnostic — default behaviour resolves to canonical destinations.',
		},
		pretty: {
			type: 'boolean',
			desc: 'Pretty-print JSON output',
		},
	},
} as const satisfies CommandDef;

/** Parsed flag values for the `query` CLI command. */
type QueryFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `query` CLI command.
 *
 * Opens a `.nitpicker` archive, dispatches the specified sub-command
 * to the appropriate `@nitpicker/query` function, and prints the result
 * as JSON to stdout.
 * @param args - Positional arguments; first is the `.nitpicker` file path, second is the sub-command.
 * @param flags - Parsed CLI flags from the `query` command.
 * @returns Resolves when the query is complete.
 *   Exits with code 1 if arguments are missing/invalid or an error occurs.
 */
export async function query(args: string[], flags: QueryFlags) {
	const filePath = args[0];
	if (!filePath) {
		// eslint-disable-next-line no-console
		console.error('Error: No .nitpicker file specified.');
		// eslint-disable-next-line no-console
		console.error('Usage: nitpicker query <file> <sub-command> [options]');
		process.exit(1);
	}

	const subCommandArg = args[1];
	if (!subCommandArg || !VALID_SUB_COMMANDS.includes(subCommandArg as QuerySubCommand)) {
		// eslint-disable-next-line no-console
		console.error(
			subCommandArg
				? `Error: Unknown sub-command: ${subCommandArg}`
				: 'Error: No sub-command specified.',
		);
		// eslint-disable-next-line no-console
		console.error(`Valid sub-commands: ${VALID_SUB_COMMANDS.join(', ')}`);
		process.exit(1);
	}

	const subCommand = subCommandArg as QuerySubCommand;
	const absFilePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);

	const manager = new ArchiveManager();
	try {
		const { archiveId, accessor } = await manager.open(absFilePath);
		try {
			const result = await dispatchQuery(accessor, subCommand, flags);
			const output = JSON.stringify(result, null, flags.pretty ? 2 : undefined);
			// eslint-disable-next-line no-console
			console.log(output);
		} finally {
			try {
				await manager.close(archiveId);
			} catch {
				// close failure should not mask the original error
			}
		}
	} catch (error) {
		formatCliError(error, false);
		process.exit(1);
	}
}
