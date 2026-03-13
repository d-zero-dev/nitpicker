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
	| 'resource-referrers';

/**
 * List of all valid query sub-command names.
 */
export const VALID_SUB_COMMANDS: readonly QuerySubCommand[] = [
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
];
