import type { QuerySubCommand } from './types.js';
import type { commandDef } from '../commands/query.js';
import type { InferFlags } from '@d-zero/roar';
import type { ContentTypeCategory } from '@nitpicker/query';

import { CONTENT_TYPE_CATEGORIES } from '@nitpicker/query';

/** Parsed flag values for the query CLI command. */
type QueryFlags = InferFlags<typeof commandDef.flags>;

/**
 * Validates the `--contentTypeCategory` flag against {@link CONTENT_TYPE_CATEGORIES}.
 * Throws a user-friendly error when the value is not a known category,
 * matching the validation pattern used by the other enum-shaped flags
 * (`--sortBy`, `--sortOrder`, `--type`, `--field`).
 * @param value - The raw flag value.
 * @returns The narrowed category, or `undefined` when the flag was omitted.
 * @throws {Error} If the value is set but not a recognised category.
 */
function parseContentTypeCategoryFlag(
	value: string | undefined,
): ContentTypeCategory | undefined {
	if (value == null) {
		return undefined;
	}
	if (!(CONTENT_TYPE_CATEGORIES as readonly string[]).includes(value)) {
		throw new Error(
			`Invalid --contentTypeCategory value: ${value}. Must be one of: ${CONTENT_TYPE_CATEGORIES.join(', ')}`,
		);
	}
	return value as ContentTypeCategory;
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
				contentTypeCategory: parseContentTypeCategoryFlag(flags.contentTypeCategory),
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
					'--type is required for the links sub-command. Must be one of: broken, external',
				);
			}
			if (!['broken', 'external'].includes(flags.type)) {
				throw new Error(
					`Invalid --type value: ${flags.type}. Must be one of: broken, external`,
				);
			}
			return {
				type: flags.type as 'broken' | 'external',
				includeRedirectSources: flags.includeRedirectSources,
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
		case 'error-kinds': {
			// No options: the aggregation always covers the whole archive.
			return {};
		}
		case 'pages-by-tag': {
			if (!flags.provider) {
				throw new Error('--provider is required for the pages-by-tag sub-command.');
			}
			return {
				provider: flags.provider,
				externalId: flags.externalId,
				limit: flags.limit,
				offset: flags.offset,
			};
		}
		case 'count-pages-by-tag': {
			if (!flags.provider) {
				throw new Error('--provider is required for the count-pages-by-tag sub-command.');
			}
			return {
				provider: flags.provider,
				externalId: flags.externalId,
			};
		}
		case 'pages-by-jsonld-type': {
			if (!flags.type) {
				throw new Error('--type is required for the pages-by-jsonld-type sub-command.');
			}
			return {
				type: flags.type,
				limit: flags.limit,
				offset: flags.offset,
			};
		}
		case 'count-pages-by-jsonld-type': {
			if (!flags.type) {
				throw new Error(
					'--type is required for the count-pages-by-jsonld-type sub-command.',
				);
			}
			return { type: flags.type };
		}
		case 'tag-inventory': {
			return {};
		}
		case 'page-jsonld': {
			if (!flags.url) {
				throw new Error('--url is required for the page-jsonld sub-command.');
			}
			return { url: flags.url, full: flags.full };
		}
		case 'page-jsonld-overview': {
			if (!flags.url) {
				throw new Error('--url is required for the page-jsonld-overview sub-command.');
			}
			return { url: flags.url };
		}
		case 'page-tags': {
			if (!flags.url) {
				throw new Error('--url is required for the page-tags sub-command.');
			}
			return { url: flags.url };
		}
		case 'isolated-pages':
		case 'isolated-clusters':
		case 'unused-resources':
		case 'inventory-runs': {
			// Pagination-only — no required filters.
			return {
				limit: flags.limit,
				offset: flags.offset,
			};
		}
		case 'get-isolated-cluster': {
			if (!flags.representativeUrl) {
				throw new Error(
					'--representativeUrl is required for the get-isolated-cluster sub-command.',
				);
			}
			return { representativeUrl: flags.representativeUrl };
		}
		default: {
			const _exhaustive: never = subCommand;
			throw new Error(`Unknown sub-command: ${String(_exhaustive)}`);
		}
	}
}
