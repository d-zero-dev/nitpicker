import type { CrawlFlagInput } from './types.js';

/**
 * Maps CLI flag names to CrawlConfig property names.
 *
 * Transforms singular CLI flag names (`exclude`, `excludeKeyword`, `excludeUrl`)
 * to their plural CrawlConfig counterparts (`excludes`, `excludeKeywords`, `excludeUrls`),
 * and parses the comma-separated `scope` string into an array.
 *
 * CLI-only flags (`resume`, `silent`, `diff`, `single`, `listFile`, `list`)
 * are excluded from the output by explicitly mapping only CrawlConfig-compatible properties.
 * @param flags - Parsed CLI flags from the `crawl` command.
 * @returns An object compatible with `Partial<CrawlConfig>`.
 */
export function mapFlagsToCrawlConfig(flags: CrawlFlagInput) {
	return {
		interval: flags.interval,
		image: flags.image,
		fetchExternal: flags.fetchExternal,
		parallels: flags.parallels,
		recursive: flags.recursive,
		disableQueries: flags.disableQueries,
		imageFileSizeThreshold: flags.imageFileSizeThreshold,
		maxExcludedDepth: flags.maxExcludedDepth,
		retry: flags.retry,
		userAgent: flags.userAgent,
		ignoreRobots: flags.ignoreRobots,
		verbose: flags.verbose,
		excludes: flags.exclude,
		excludeKeywords: flags.excludeKeyword,
		excludeUrls: flags.excludeUrl,
		scope: flags.scope?.split(',').map((s) => s.trim()),
	};
}
