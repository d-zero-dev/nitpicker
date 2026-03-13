import type { QuerySubCommand } from './types.js';

/**
 * Flat CLI flags passed to the query command.
 * All fields are optional since they come from parsed CLI arguments.
 */
interface QueryFlags {
	/** Maximum number of results to return. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
	/** Target URL for page-detail, html, or resource-referrers queries. */
	url?: string;
	/** Filter by exact HTTP status code. */
	status?: number;
	/** Filter by minimum HTTP status code (inclusive). */
	statusMin?: number;
	/** Filter by maximum HTTP status code (inclusive). */
	statusMax?: number;
	/** Filter by external (true) or internal (false). */
	isExternal?: boolean;
	/** Filter to pages missing title. */
	missingTitle?: boolean;
	/** Filter to pages missing description. */
	missingDescription?: boolean;
	/** Filter to pages with noindex. */
	noindex?: boolean;
	/** URL pattern to filter (SQL LIKE pattern). */
	urlPattern?: string;
	/** Directory path prefix to filter by. */
	directory?: string;
	/** Field to sort by (url, status, title). */
	sortBy?: string;
	/** Sort direction (asc, desc). */
	sortOrder?: string;
	/** Filter type for links or mismatches sub-commands. */
	type?: string;
	/** Filter by content type prefix. */
	contentType?: string;
	/** Filter to images missing alt attribute. */
	missingAlt?: boolean;
	/** Filter to images missing width/height. */
	missingDimensions?: boolean;
	/** Filter to images exceeding this dimension threshold. */
	oversizedThreshold?: number;
	/** Filter by validator name. */
	validator?: string;
	/** Filter by severity level. */
	severity?: string;
	/** Filter by rule ID. */
	rule?: string;
	/** Field to check for duplicates (title, description). */
	field?: string;
	/** Only show pages missing security headers. */
	missingOnly?: boolean;
	/** Maximum HTML length to return. */
	maxLength?: number;
}

/**
 * Builds the options object for a specific query function from flat CLI flags.
 *
 * Validates required flags per sub-command and returns the appropriate
 * options shape for the corresponding `@nitpicker/query` function.
 * @param subCommand - The query sub-command name.
 * @param flags - The parsed CLI flags.
 * @returns The options object appropriate for the sub-command's query function.
 * @throws {Error} If required flags are missing or have invalid values.
 */
export function mapFlagsToQueryOptions(
	subCommand: QuerySubCommand,
	flags: QueryFlags,
): unknown {
	switch (subCommand) {
		case 'summary': {
			return {};
		}
		case 'pages': {
			if (flags.sortBy != null && !['url', 'status', 'title'].includes(flags.sortBy)) {
				throw new Error(
					`Invalid --sortBy value: ${flags.sortBy}. Must be one of: url, status, title`,
				);
			}
			if (flags.sortOrder != null && !['asc', 'desc'].includes(flags.sortOrder)) {
				throw new Error(
					`Invalid --sortOrder value: ${flags.sortOrder}. Must be one of: asc, desc`,
				);
			}
			return {
				status: flags.status,
				statusMin: flags.statusMin,
				statusMax: flags.statusMax,
				isExternal: flags.isExternal,
				missingTitle: flags.missingTitle,
				missingDescription: flags.missingDescription,
				noindex: flags.noindex,
				urlPattern: flags.urlPattern,
				directory: flags.directory,
				sortBy: flags.sortBy as 'url' | 'status' | 'title' | undefined,
				sortOrder: flags.sortOrder as 'asc' | 'desc' | undefined,
				limit: flags.limit,
				offset: flags.offset,
			};
		}
		case 'page-detail': {
			if (!flags.url) {
				throw new Error('--url is required for the page-detail sub-command.');
			}
			return { url: flags.url };
		}
		case 'html': {
			if (!flags.url) {
				throw new Error('--url is required for the html sub-command.');
			}
			return { url: flags.url, maxLength: flags.maxLength };
		}
		case 'links': {
			if (!flags.type) {
				throw new Error(
					'--type is required for the links sub-command. Must be one of: broken, external, orphaned',
				);
			}
			if (!['broken', 'external', 'orphaned'].includes(flags.type)) {
				throw new Error(
					`Invalid --type value: ${flags.type}. Must be one of: broken, external, orphaned`,
				);
			}
			return {
				type: flags.type as 'broken' | 'external' | 'orphaned',
				limit: flags.limit,
				offset: flags.offset,
			};
		}
		case 'resources': {
			return {
				contentType: flags.contentType,
				isExternal: flags.isExternal,
				limit: flags.limit,
				offset: flags.offset,
			};
		}
		case 'images': {
			return {
				missingAlt: flags.missingAlt,
				missingDimensions: flags.missingDimensions,
				oversizedThreshold: flags.oversizedThreshold,
				urlPattern: flags.urlPattern,
				limit: flags.limit,
				offset: flags.offset,
			};
		}
		case 'violations': {
			return {
				validator: flags.validator,
				severity: flags.severity,
				rule: flags.rule,
				limit: flags.limit,
				offset: flags.offset,
			};
		}
		case 'duplicates': {
			if (flags.field != null && !['title', 'description'].includes(flags.field)) {
				throw new Error(
					`Invalid --field value: ${flags.field}. Must be one of: title, description`,
				);
			}
			return {
				field: (flags.field as 'title' | 'description' | undefined) ?? 'title',
				limit: flags.limit,
			};
		}
		case 'mismatches': {
			if (!flags.type) {
				throw new Error(
					'--type is required for the mismatches sub-command. Must be one of: canonical, og:title, og:description',
				);
			}
			if (!['canonical', 'og:title', 'og:description'].includes(flags.type)) {
				throw new Error(
					`Invalid --type value: ${flags.type}. Must be one of: canonical, og:title, og:description`,
				);
			}
			return {
				type: flags.type as 'canonical' | 'og:title' | 'og:description',
				limit: flags.limit,
				offset: flags.offset,
			};
		}
		case 'headers': {
			return {
				limit: flags.limit,
				offset: flags.offset,
				missingOnly: flags.missingOnly,
			};
		}
		case 'resource-referrers': {
			if (!flags.url) {
				throw new Error('--url is required for the resource-referrers sub-command.');
			}
			return { url: flags.url };
		}
	}
}
