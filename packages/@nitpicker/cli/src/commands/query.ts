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
	usage: '<file> <sub-command> [options]',
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
			valueName: 'cursor',
			desc: 'Opaque pagination cursor from a previous result',
		},
		direction: {
			type: 'string',
			valueName: 'next|prev',
			desc: 'Direction to walk from --cursor (default: next)',
		},
		pagesLimit: {
			type: 'number',
			desc: 'Inline member-page URL sample size per duplicate group or body-hash cluster. Defaults to 20.',
		},
		minCount: {
			type: 'number',
			desc: 'Minimum cluster size to include. Defaults to 10.',
		},
		url: {
			type: 'string',
			valueName: 'URL',
			desc: 'Target page or resource URL',
		},
		status: {
			type: 'number',
			valueName: 'code',
			desc: 'Filter by exact HTTP status code',
		},
		statusMin: {
			type: 'number',
			valueName: 'code',
			desc: 'Filter by minimum HTTP status code (inclusive)',
		},
		statusMax: {
			type: 'number',
			valueName: 'code',
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
		isDedupeCapped: {
			type: 'boolean',
			desc: 'Filter to pages whose URL shape --dedupe-cap captured as a same-cluster crawl trap',
		},
		urlPattern: {
			type: 'string',
			valueName: 'pattern',
			desc: 'URL pattern to filter (SQL LIKE pattern)',
		},
		directory: {
			type: 'string',
			valueName: 'path',
			desc: 'Directory path prefix to filter by',
		},
		sortBy: {
			type: 'string',
			valueName: 'field',
			desc: 'Field to sort by (url, status, title for pages; totalCount, pageCount, text, type for console-logs)',
		},
		sortOrder: {
			type: 'string',
			valueName: 'asc|desc',
			desc: 'Sort direction',
		},
		type: {
			type: 'string',
			valueName: 'type',
			desc: 'Filter type: broken, external (links); canonical, og:title, og:description (mismatches); a console message type e.g. error, warn, pageerror (console-logs); or a JSON-LD type name (pages-by-jsonld-type, count-pages-by-jsonld-type)',
		},
		contentType: {
			type: 'string',
			valueName: 'prefix',
			desc: 'Filter by content type prefix (e.g. text/css)',
		},
		contentTypeCategory: {
			type: 'string',
			valueName: 'category',
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
			valueName: 'name',
			desc: 'Filter by validator name (e.g. axe, markuplint)',
		},
		severity: {
			type: 'string',
			valueName: 'level',
			desc: 'Filter by severity level',
		},
		rule: {
			type: 'string',
			valueName: 'id',
			desc: 'Filter by rule ID',
		},
		field: {
			type: 'string',
			valueName: 'title|description',
			desc: 'Field to check for duplicates (default: title)',
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
			valueName: 'name',
			desc: 'Wappalyzer provider name',
		},
		externalId: {
			type: 'string',
			valueName: 'id',
			desc: 'External identifier (GTM-XXXX / G-XXXX / …)',
		},
		full: {
			type: 'boolean',
			desc: 'Return full raw JSON-LD. Default is slim (no raw / parsed).',
		},
		representativeUrl: {
			type: 'string',
			valueName: 'URL',
			desc: 'Representative URL of an isolated cluster; obtain via `query <file> isolated-clusters`.',
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
	// Keep each entry's `flags` list in sync with the flags that
	// `mapFlagsToQueryOptions` actually reads for that sub-command —
	// `map-flags-to-query-options.spec.ts` asserts the two stay consistent.
	subCommands: {
		summary: {
			desc: 'Archive-wide summary (page counts, status breakdown, crawl metadata)',
			usage: '<file> summary',
			flags: [],
		},
		pages: {
			desc: 'List pages with filtering, sorting, and pagination',
			usage: '<file> pages [options]',
			flags: [
				'status',
				'statusMin',
				'statusMax',
				'isExternal',
				'contentTypeCategory',
				'missingTitle',
				'missingDescription',
				'noindex',
				'isDedupeCapped',
				'urlPattern',
				'directory',
				'sortBy',
				'sortOrder',
				'limit',
				'offset',
			],
		},
		'page-detail': {
			desc: 'Show full metadata for a single page',
			usage: '<file> page-detail --url <URL>',
			flags: ['url'],
		},
		'inbound-links': {
			desc: 'List pages that link to the given URL',
			usage: '<file> inbound-links --url <URL> [options]',
			flags: ['url', 'limit', 'offset', 'cursor', 'direction'],
		},
		html: {
			desc: 'Return the stored HTML snapshot of a page',
			usage: '<file> html --url <URL> [options]',
			flags: ['url', 'maxLength'],
		},
		links: {
			desc: 'List broken or external links',
			usage: '<file> links --type <broken|external> [options]',
			flags: ['type', 'includeRedirectSources', 'limit', 'offset'],
		},
		resources: {
			desc: 'List fetched resources (CSS, JS, images, …)',
			usage: '<file> resources [options]',
			flags: ['contentType', 'isExternal', 'limit', 'offset'],
		},
		images: {
			desc: 'List images, optionally filtered to missing alt/dimensions or oversized files',
			usage: '<file> images [options]',
			flags: [
				'missingAlt',
				'missingDimensions',
				'oversizedThreshold',
				'urlPattern',
				'limit',
				'offset',
			],
		},
		violations: {
			desc: 'List validator violations (axe, markuplint, …)',
			usage: '<file> violations [options]',
			flags: [
				'validator',
				'severity',
				'rule',
				'urlPattern',
				'sortBy',
				'sortOrder',
				'limit',
				'offset',
			],
		},
		duplicates: {
			desc: 'Group pages sharing the same title or description',
			usage: '<file> duplicates [options]',
			flags: ['field', 'limit', 'pagesLimit', 'cursor', 'direction', 'offset'],
		},
		'duplicate-bodies': {
			desc: 'List pages whose body content is identical',
			usage: '<file> duplicate-bodies [options]',
			flags: ['limit', 'offset'],
		},
		mismatches: {
			desc: 'List canonical / og:title / og:description mismatches',
			usage: '<file> mismatches --type <type> [options]',
			flags: ['type', 'limit', 'offset', 'cursor', 'direction'],
		},
		headers: {
			desc: 'Check security-related HTTP response headers per page',
			usage: '<file> headers [options]',
			flags: ['limit', 'offset', 'missingOnly'],
		},
		'resource-referrers': {
			desc: 'List pages that reference the given resource',
			usage: '<file> resource-referrers --url <URL> [options]',
			flags: ['url', 'limit', 'cursor'],
		},
		'error-kinds': {
			desc: 'Aggregate crawl errors by kind',
			usage: '<file> error-kinds',
			flags: [],
		},
		'pages-by-tag': {
			desc: 'List pages using a given tag provider (e.g. Google Tag Manager)',
			usage: '<file> pages-by-tag --provider <name> [options]',
			flags: ['provider', 'externalId', 'limit', 'offset'],
		},
		'pages-by-jsonld-type': {
			desc: 'List pages containing a given JSON-LD type',
			usage: '<file> pages-by-jsonld-type --type <type> [options]',
			flags: ['type', 'limit', 'offset'],
		},
		'tag-inventory': {
			desc: 'Aggregate detected tags/trackers across the archive',
			usage: '<file> tag-inventory',
			flags: [],
		},
		'page-jsonld': {
			desc: 'Return JSON-LD blocks of a single page',
			usage: '<file> page-jsonld --url <URL> [options]',
			flags: ['url', 'full'],
		},
		'page-tags': {
			desc: 'Return detected tags of a single page',
			usage: '<file> page-tags --url <URL>',
			flags: ['url'],
		},
		'count-pages-by-tag': {
			desc: 'Count pages using a given tag provider',
			usage: '<file> count-pages-by-tag --provider <name> [options]',
			flags: ['provider', 'externalId'],
		},
		'count-pages-by-jsonld-type': {
			desc: 'Count pages containing a given JSON-LD type',
			usage: '<file> count-pages-by-jsonld-type --type <type>',
			flags: ['type'],
		},
		'page-jsonld-overview': {
			desc: 'Summarize JSON-LD types on a single page',
			usage: '<file> page-jsonld-overview --url <URL>',
			flags: ['url'],
		},
		'isolated-pages': {
			desc: 'List pages with no inbound links',
			usage: '<file> isolated-pages [options]',
			flags: ['limit', 'offset'],
		},
		'isolated-clusters': {
			desc: 'List clusters of pages isolated from the main link graph',
			usage: '<file> isolated-clusters [options]',
			flags: ['limit', 'offset'],
		},
		'get-isolated-cluster': {
			desc: 'Show one isolated cluster by its representative URL',
			usage: '<file> get-isolated-cluster --representative-url <URL>',
			flags: ['representativeUrl'],
		},
		'unused-resources': {
			desc: 'List resources not referenced by any page',
			usage: '<file> unused-resources [options]',
			flags: ['limit', 'offset'],
		},
		'inventory-runs': {
			desc: 'List --inventory import runs recorded in the archive',
			usage: '<file> inventory-runs [options]',
			flags: ['limit', 'offset'],
		},
		outages: {
			desc: 'List network outage windows detected during the crawl',
			usage: '<file> outages [options]',
			flags: ['limit', 'offset'],
		},
		'console-logs': {
			desc: 'Aggregate browser console messages across pages',
			usage: '<file> console-logs [options]',
			flags: ['type', 'sortBy', 'sortOrder', 'limit', 'offset'],
		},
		'page-console-logs': {
			desc: 'Return console messages of a single page',
			usage: '<file> page-console-logs --url <URL>',
			flags: ['url'],
		},
		'duplicate-clusters': {
			desc: 'List clusters of pages sharing an identical body hash',
			usage: '<file> duplicate-clusters [options]',
			flags: ['minCount', 'limit', 'offset', 'pagesLimit'],
		},
		'dedupe-cap-events': {
			desc: 'List URL shapes capped by the --dedupe-cap crawl backstop',
			usage: '<file> dedupe-cap-events [options]',
			flags: ['limit', 'offset'],
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
		console.error('Usage: npx @nitpicker/cli query <file> <sub-command> [options]');
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
