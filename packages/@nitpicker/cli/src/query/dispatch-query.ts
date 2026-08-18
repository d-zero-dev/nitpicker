import type { QuerySubCommand } from './types.js';
import type { commandDef } from '../commands/query-def.js';
import type { InferFlags } from '@d-zero/roar';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type {
	ListPagesOptions,
	ListLinksOptions,
	ListResourcesOptions,
	ListImagesOptions,
	GetViolationsOptions,
	GetDuplicatesFastPathOptions,
	FindMismatchesFastPathOptions,
	ListConsoleLogsOptions,
	TechnologySignalEntry,
} from '@nitpicker/query';

import {
	countPagesByJsonLdType,
	countPagesByTechnology,
	findDuplicateBodies,
	getDuplicatesFastPath,
	getErrorKindsFastPath,
	getHeaderChecksFastPath,
	getImagesFastPath,
	getIsolatedClusterFastPath,
	getMismatchesFastPath,
	getPageConsoleLogs,
	getPageDetail,
	getPageHtml,
	getPageJsonLd,
	getPageJsonLdOverview,
	getPageTechnologies,
	getResourceReferrers,
	getSummaryFastPath,
	getTechnologyInventoryFastPath,
	getViolations,
	listConsoleLogs,
	listDedupeCapEvents,
	listDuplicateBodyClusters,
	listInboundLinks,
	listInventoryRuns,
	listIsolatedClustersFastPath,
	listIsolatedPagesFastPath,
	listLinks,
	listNetworkOutages,
	listPages,
	listPagesByJsonLdType,
	listPagesByTechnology,
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
 * @param onSortProgress - Forwarded to `pages`/`mismatches`' underlying
 *   `listPages`/`findMismatches` calls (issue #294) — see
 *   `ListPagesOptions.onSortProgress`. Called with human-readable status
 *   lines while a cold connection's `sortBy: 'url'` lazily builds the URL
 *   natural-sort TEMP table. Omit for silent (the default).
 * @returns The query result as a JSON-serializable value.
 * @throws {Error} If a required resource is not found (page-detail, html, resource-referrers).
 */
export async function dispatchQuery(
	accessor: ArchiveAccessor,
	subCommand: QuerySubCommand,
	flags: QueryFlags,
	onSortProgress?: (message: string) => void,
): Promise<unknown> {
	const options = mapFlagsToQueryOptions(subCommand, flags);

	switch (subCommand) {
		case 'summary': {
			return getSummaryFastPath(accessor);
		}
		case 'pages': {
			return listPages(accessor, { ...(options as ListPagesOptions), onSortProgress });
		}
		case 'page-detail': {
			const { url } = options as { url: string };
			const result = await getPageDetail(accessor, url);
			if (!result) {
				throw new Error(`Page not found: ${url}`);
			}
			return result;
		}
		case 'inbound-links': {
			const { url, limit, offset, cursor, direction } = options as {
				url: string;
				limit?: number;
				offset?: number;
				cursor?: string;
				direction?: 'next' | 'prev';
			};
			const result = await listInboundLinks(accessor, {
				url,
				limit,
				offset,
				cursor,
				direction,
			});
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
			return getImagesFastPath(accessor, options as ListImagesOptions);
		}
		case 'violations': {
			return getViolations(accessor, options as GetViolationsOptions);
		}
		case 'duplicates': {
			return getDuplicatesFastPath(accessor, options as GetDuplicatesFastPathOptions);
		}
		case 'duplicate-bodies': {
			const { limit, offset } = options as { limit?: number; offset?: number };
			return findDuplicateBodies(accessor, limit, offset);
		}
		case 'duplicate-clusters': {
			return listDuplicateBodyClusters(
				accessor,
				options as {
					minCount?: number;
					limit?: number;
					offset?: number;
					samplePagesLimit?: number;
				},
			);
		}
		case 'dedupe-cap-events': {
			const { limit, offset } = options as { limit?: number; offset?: number };
			return listDedupeCapEvents(accessor, { limit, offset });
		}
		case 'mismatches': {
			const { type, ...rest } = options as {
				type: 'canonical' | 'og:title' | 'og:description';
			} & FindMismatchesFastPathOptions;
			return getMismatchesFastPath(accessor, type, { ...rest, onSortProgress });
		}
		case 'headers': {
			return getHeaderChecksFastPath(
				accessor,
				options as { limit?: number; offset?: number; missingOnly?: boolean },
			);
		}
		case 'resource-referrers': {
			const { url, limit, cursor } = options as {
				url: string;
				limit?: number;
				cursor?: string;
			};
			const result = await getResourceReferrers(accessor, {
				resourceUrl: url,
				limit,
				cursor,
			});
			if (!result) {
				throw new Error(`Resource not found: ${url}`);
			}
			return result;
		}
		case 'error-kinds': {
			return getErrorKindsFastPath(accessor);
		}
		case 'pages-by-technology': {
			const { technology, minConfidence, signalType, limit, offset } = options as {
				technology: string;
				minConfidence?: number;
				signalType?: TechnologySignalEntry['signalType'];
				limit?: number;
				offset?: number;
			};
			return listPagesByTechnology(accessor, {
				technology,
				minConfidence,
				signalType,
				limit,
				offset,
			});
		}
		case 'count-pages-by-technology': {
			const { technology, minConfidence, signalType } = options as {
				technology: string;
				minConfidence?: number;
				signalType?: TechnologySignalEntry['signalType'];
			};
			return countPagesByTechnology(accessor, { technology, minConfidence, signalType });
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
		case 'technology-inventory': {
			return getTechnologyInventoryFastPath(accessor);
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
			return listIsolatedPagesFastPath(accessor, { limit, offset });
		}
		case 'isolated-clusters': {
			const { limit, offset } = options as { limit?: number; offset?: number };
			return listIsolatedClustersFastPath(accessor, { limit, offset });
		}
		case 'get-isolated-cluster': {
			const { representativeUrl } = options as { representativeUrl: string };
			const result = await getIsolatedClusterFastPath(accessor, representativeUrl);
			if (result === null) {
				throw new Error(
					`No isolated cluster found for representativeUrl: ${representativeUrl}`,
				);
			}
			return result;
		}
		case 'unused-resources': {
			const { limit, offset } = options as { limit?: number; offset?: number };
			return listUnusedResources(accessor, { limit, offset });
		}
		case 'inventory-runs': {
			const { limit, offset } = options as { limit?: number; offset?: number };
			return listInventoryRuns(accessor, { limit, offset });
		}
		case 'outages': {
			const { limit, offset } = options as { limit?: number; offset?: number };
			return listNetworkOutages(accessor, { limit, offset });
		}
		case 'page-technologies': {
			const { url } = options as { url: string };
			return getPageTechnologies(accessor, url);
		}
		case 'console-logs': {
			return listConsoleLogs(accessor, options as ListConsoleLogsOptions);
		}
		case 'page-console-logs': {
			const { url } = options as { url: string };
			return getPageConsoleLogs(accessor, url);
		}
		default: {
			const _exhaustive: never = subCommand;
			throw new Error(`Unknown sub-command: ${String(_exhaustive)}`);
		}
	}
}
