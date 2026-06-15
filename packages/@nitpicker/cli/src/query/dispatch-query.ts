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
	getSummary,
	listPages,
	getPageDetail,
	getPageHtml,
	listLinks,
	listResources,
	listImages,
	getViolations,
	findDuplicates,
	findMismatches,
	checkHeaders,
	getResourceReferrers,
	getErrorKinds,
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
		default: {
			const _exhaustive: never = subCommand;
			throw new Error(`Unknown sub-command: ${String(_exhaustive)}`);
		}
	}
}
