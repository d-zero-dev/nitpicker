import type { QuerySubCommand } from './types.js';
import type { commandDef } from '../commands/query.js';
import type { InferFlags } from '@d-zero/roar';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type {
	ListPagesOptions,
	ListLinksOptions,
	ListResourcesOptions,
	ListImagesOptions,
	GetViolationsOptions,
} from '@nitpicker/query';

import {
	checkHeaders,
	countPagesByJsonLdType,
	countPagesByTag,
	findDuplicates,
	findMismatches,
	getErrorKinds,
	getPageDetail,
	getPageHtml,
	getPageJsonLd,
	getPageJsonLdOverview,
	getPageTags,
	getResourceReferrers,
	getSummary,
	getTagInventory,
	getViolations,
	listImages,
	listIsolatedPages,
	listLinks,
	listPages,
	listPagesByJsonLdType,
	listPagesByTag,
	listResources,
	listUnusedResources,
} from '@nitpicker/query';

import { mapFlagsToQueryOptions } from './map-flags-to-query-options.js';

/** Parsed flag values for the query CLI command. */
type QueryFlags = InferFlags<typeof commandDef.flags>;

/**
 * Dispatches a query sub-command to the appropriate `@nitpicker/query` function.
 *
 * Maps each sub-command name to its corresponding query function, builds the
 * options from CLI flags via {@link mapFlagsToQueryOptions}, and returns the
 * JSON-serializable result.
 * @param accessor - The opened archive accessor.
 * @param subCommand - The sub-command name.
 * @param flags - The parsed CLI flags.
 * @returns The query result as a JSON-serializable value.
 * @throws {Error} If a required resource is not found (page-detail, html, resource-referrers).
 */
export async function dispatchQuery(
	accessor: ArchiveAccessor,
	subCommand: QuerySubCommand,
	flags: QueryFlags,
): Promise<unknown> {
	const options = mapFlagsToQueryOptions(subCommand, flags);

	switch (subCommand) {
		case 'summary': {
			return getSummary(accessor);
		}
		case 'pages': {
			return listPages(accessor, options as ListPagesOptions);
		}
		case 'page-detail': {
			const { url } = options as { url: string };
			const result = await getPageDetail(accessor, url);
			if (!result) {
				throw new Error(`Page not found: ${url}`);
			}
			return result;
		}
		case 'html': {
			const { url, maxLength } = options as { url: string; maxLength?: number };
			const result = await getPageHtml(accessor, url, maxLength);
			if (!result) {
				throw new Error(`Page HTML not found: ${url}`);
			}
			return result;
		}
		case 'links': {
			return listLinks(accessor, options as ListLinksOptions);
		}
		case 'resources': {
			return listResources(accessor, options as ListResourcesOptions);
		}
		case 'images': {
			return listImages(accessor, options as ListImagesOptions);
		}
		case 'violations': {
			return getViolations(accessor, options as GetViolationsOptions);
		}
		case 'duplicates': {
			const { field, limit } = options as {
				field: 'title' | 'description';
				limit?: number;
			};
			return findDuplicates(accessor, field, limit);
		}
		case 'mismatches': {
			const { type, limit, offset } = options as {
				type: 'canonical' | 'og:title' | 'og:description';
				limit?: number;
				offset?: number;
			};
			return findMismatches(accessor, type, limit, offset);
		}
		case 'headers': {
			return checkHeaders(
				accessor,
				options as { limit?: number; offset?: number; missingOnly?: boolean },
			);
		}
		case 'resource-referrers': {
			const { url } = options as { url: string };
			const result = await getResourceReferrers(accessor, url);
			if (!result) {
				throw new Error(`Resource not found: ${url}`);
			}
			return result;
		}
		case 'error-kinds': {
			return getErrorKinds(accessor);
		}
		case 'pages-by-tag': {
			const { provider, externalId, limit, offset } = options as {
				provider: string;
				externalId?: string;
				limit?: number;
				offset?: number;
			};
			return listPagesByTag(accessor, { provider, externalId, limit, offset });
		}
		case 'count-pages-by-tag': {
			const { provider, externalId } = options as {
				provider: string;
				externalId?: string;
			};
			return countPagesByTag(accessor, { provider, externalId });
		}
		case 'pages-by-jsonld-type': {
			const { type, limit, offset } = options as {
				type: string;
				limit?: number;
				offset?: number;
			};
			return listPagesByJsonLdType(accessor, { type, limit, offset });
		}
		case 'count-pages-by-jsonld-type': {
			const { type } = options as { type: string };
			return countPagesByJsonLdType(accessor, { type });
		}
		case 'tag-inventory': {
			return getTagInventory(accessor);
		}
		case 'page-jsonld': {
			const { url, full } = options as { url: string; full?: boolean };
			return getPageJsonLd(accessor, url, !full);
		}
		case 'page-jsonld-overview': {
			const { url } = options as { url: string };
			return getPageJsonLdOverview(accessor, url);
		}
		case 'isolated-pages': {
			const { limit, offset } = options as { limit?: number; offset?: number };
			return listIsolatedPages(accessor, { limit, offset });
		}
		case 'unused-resources': {
			const { limit, offset } = options as { limit?: number; offset?: number };
			return listUnusedResources(accessor, { limit, offset });
		}
		case 'page-tags': {
			const { url } = options as { url: string };
			return getPageTags(accessor, url);
		}
		default: {
			const _exhaustive: never = subCommand;
			throw new Error(`Unknown sub-command: ${String(_exhaustive)}`);
		}
	}
}
