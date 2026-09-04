/**
 * Valid sub-command names for the query command.
 */
export type QuerySubCommand =
	| 'summary'
	| 'pages'
	| 'page-detail'
	| 'inbound-links'
	| 'html'
	| 'links'
	| 'resources'
	| 'images'
	| 'violations'
	| 'duplicates'
	| 'duplicate-bodies'
	| 'mismatches'
	| 'headers'
	| 'resource-referrers'
	| 'error-kinds'
	| 'pages-by-technology'
	| 'pages-by-jsonld-type'
	| 'technology-inventory'
	| 'page-jsonld'
	| 'page-technologies'
	| 'count-pages-by-technology'
	| 'count-pages-by-jsonld-type'
	| 'page-jsonld-overview'
	| 'isolated-pages'
	| 'isolated-clusters'
	| 'get-isolated-cluster'
	| 'unused-resources'
	| 'list-reconcile-runs'
	| 'outages'
	| 'console-logs'
	| 'page-console-logs'
	| 'duplicate-clusters'
	| 'dedupe-cap-events'
	| 'match-urls';

/**
 * List of all valid query sub-command names.
 */
export const VALID_SUB_COMMANDS = [
	'summary',
	'pages',
	'page-detail',
	'inbound-links',
	'html',
	'links',
	'resources',
	'images',
	'violations',
	'duplicates',
	'duplicate-bodies',
	'mismatches',
	'headers',
	'resource-referrers',
	'error-kinds',
	'pages-by-technology',
	'pages-by-jsonld-type',
	'technology-inventory',
	'page-jsonld',
	'page-technologies',
	'count-pages-by-technology',
	'count-pages-by-jsonld-type',
	'page-jsonld-overview',
	'isolated-pages',
	'isolated-clusters',
	'get-isolated-cluster',
	'unused-resources',
	'list-reconcile-runs',
	'outages',
	'console-logs',
	'page-console-logs',
	'duplicate-clusters',
	'dedupe-cap-events',
	'match-urls',
] as const satisfies readonly QuerySubCommand[];
