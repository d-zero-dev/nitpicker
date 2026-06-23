/**
 * Valid sub-command names for the query command.
 */
export type QuerySubCommand =
	| 'summary'
	| 'pages'
	| 'page-detail'
	| 'html'
	| 'links'
	| 'resources'
	| 'images'
	| 'violations'
	| 'duplicates'
	| 'mismatches'
	| 'headers'
	| 'resource-referrers'
	| 'error-kinds'
	| 'pages-by-tag'
	| 'pages-by-jsonld-type'
	| 'tag-inventory'
	| 'page-jsonld'
	| 'page-tags'
	| 'count-pages-by-tag'
	| 'count-pages-by-jsonld-type'
	| 'page-jsonld-overview'
	| 'isolated-pages'
	| 'isolated-clusters'
	| 'get-isolated-cluster'
	| 'unused-resources'
	| 'inventory-runs';

/**
 * List of all valid query sub-command names.
 */
export const VALID_SUB_COMMANDS = [
	'summary',
	'pages',
	'page-detail',
	'html',
	'links',
	'resources',
	'images',
	'violations',
	'duplicates',
	'mismatches',
	'headers',
	'resource-referrers',
	'error-kinds',
	'pages-by-tag',
	'pages-by-jsonld-type',
	'tag-inventory',
	'page-jsonld',
	'page-tags',
	'count-pages-by-tag',
	'count-pages-by-jsonld-type',
	'page-jsonld-overview',
	'isolated-pages',
	'isolated-clusters',
	'get-isolated-cluster',
	'unused-resources',
	'inventory-runs',
] as const satisfies readonly QuerySubCommand[];
