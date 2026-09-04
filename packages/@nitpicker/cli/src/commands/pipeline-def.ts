import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `pipeline` sub-command.
 * Merges flags from crawl, analyze, and report into a single command
 * that executes the full crawl → analyze → report workflow sequentially.
 *
 * Split from `pipeline.ts` (issue #294) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation — which statically imports
 * `crawl.ts`/`analyze.ts`/`report.ts` (it genuinely needs all three to run
 * the combined workflow) — loads lazily, only for the command the user
 * actually invoked. See `pipeline.ts`'s `pipeline` function for the main
 * entry point.
 */
// TODO: フラグ定義が crawl.ts / analyze.ts / report.ts と重複している。
// @d-zero/roar の CommandDef 型制約により合成が困難なため手動同期が必要。
// crawl / analyze / report にフラグを追加・変更した際はここも更新すること。
export const commandDef = {
	desc: 'Run crawl → analyze → report sequentially',
	usage: '<URL> [options]',
	flags: {
		// crawl flags
		interval: {
			type: 'number',
			shortFlag: 'I',
			valueName: 'ms',
			group: 'Crawl options',
			desc: 'Wait time in milliseconds between requests',
		},
		image: {
			type: 'boolean',
			default: true,
			group: 'Crawl options',
			desc: 'Capture image resources (use --no-image to disable)',
		},
		fetchExternal: {
			type: 'boolean',
			default: true,
			group: 'Crawl options',
			desc: 'Fetch external links (use --no-fetch-external to disable)',
		},
		parallels: {
			type: 'number',
			shortFlag: 'P',
			group: 'Crawl options',
			desc: 'Number of pages to scrape in parallel',
		},
		recursive: {
			type: 'boolean',
			default: true,
			group: 'Crawl options',
			desc: 'Follow links found on crawled pages (use --no-recursive to disable)',
		},
		exclude: {
			type: 'string',
			isMultiple: true,
			valueName: 'glob',
			group: 'Crawl options',
			desc: 'Exclude page URL paths matching the glob pattern (repeatable)',
		},
		excludeKeyword: {
			type: 'string',
			isMultiple: true,
			valueName: 'keyword',
			group: 'Crawl options',
			desc: 'Exclude pages whose document contains the keyword (repeatable)',
		},
		excludeUrl: {
			type: 'string',
			isMultiple: true,
			valueName: 'prefix',
			group: 'Crawl options',
			desc: 'Exclude external URLs starting with the prefix (repeatable)',
		},
		disableQueries: {
			type: 'boolean',
			shortFlag: 'Q',
			group: 'Crawl options',
			desc: 'Strip query strings from URLs when crawling',
		},
		imageFileSizeThreshold: {
			type: 'number',
			valueName: 'bytes',
			group: 'Crawl options',
			desc: 'File-size threshold above which images are excluded',
		},
		single: {
			type: 'boolean',
			group: 'Crawl options',
			desc: 'Crawl only the given URL without following links',
		},
		maxExcludedDepth: {
			type: 'number',
			group: 'Crawl options',
			desc: 'Maximum directory depth for excluded paths. Defaults to 10.',
		},
		retry: {
			type: 'number',
			default: 3,
			group: 'Crawl options',
			desc: 'Number of retry attempts per URL on scrape failure',
		},
		maxAutoRetry: {
			type: 'number',
			default: 3,
			group: 'Crawl options',
			desc: 'Maximum whole-session auto-retry attempts (exponential backoff, 30s-5min) when a crawl session ends with pages still pending. 0 disables auto-retry: any pages still pending after the session abort it immediately, leaving the un-packaged stub for --resume/--retry-failed.',
		},
		list: {
			type: 'string',
			isMultiple: true,
			valueName: 'URL',
			group: 'Crawl options',
			desc: 'Crawl only the given page URLs (repeat for multiple URLs; disables recursion)',
		},
		listFile: {
			type: 'string',
			valueName: 'file',
			group: 'Crawl options',
			desc: 'Crawl only the page URLs listed in the file, one per line (disables recursion)',
		},
		userAgent: {
			type: 'string',
			valueName: 'string',
			group: 'Crawl options',
			desc: 'Custom User-Agent string for HTTP requests',
		},
		ignoreRobots: {
			type: 'boolean',
			group: 'Crawl options',
			desc: 'Ignore robots.txt restrictions (use responsibly)',
		},
		mainContentSelector: {
			type: 'string',
			valueName: 'selector',
			group: 'Crawl options',
			desc: 'CSS selector overriding automatic main-content-region detection',
		},
		output: {
			type: 'string',
			shortFlag: 'o',
			valueName: 'path',
			group: 'Crawl options',
			desc: 'Output file path for the .nitpicker archive',
		},
		strict: {
			type: 'boolean',
			group: 'Crawl options',
			desc: 'Treat external link errors as fatal (exit code 1 instead of 2)',
		},
		dedupeCap: {
			type: 'number',
			default: 10,
			group: 'Crawl options',
			desc: 'Same-cluster soft cap: stop enqueueing newly-discovered internal URLs whose shape (e.g. `/news/date/{n}/`) has accumulated this many matching-title/description/og-tag observations. On by default (10) as a backstop against a site that keeps serving 2xx for a self-generating pager/query-parameter trap — false positives on legitimate large sections are structurally prevented (each such page differs in title/og tags, so the majority-vote counter never accumulates). Use --no-dedupe-cap (or --dedupeCap 0) to disable. See `query dedupe-cap-events` for what fired.',
		},
		dedupeMapCap: {
			type: 'number',
			group: 'Crawl options',
			desc: 'Hard cap on the number of distinct URL shapes --dedupe-cap tracks at once; the least-recently-touched shape is evicted beyond this. Only relevant when --dedupe-cap is enabled.',
		},
		skipTechnologyJsScan: {
			type: 'boolean',
			group: 'Crawl options',
			desc: 'Skip the post-crawl JS resource scan for technology license comments (avoids the extra network requests it makes against already-discovered JS resources)',
		},
		// analyze flags
		all: {
			type: 'boolean',
			group: 'Analyze options',
			desc: 'Run all analysis plugins and generate all report sheets without interactive prompt',
		},
		plugin: {
			type: 'string',
			isMultiple: true,
			valueName: 'name',
			group: 'Analyze options',
			desc: 'Specify plugins to run (e.g. --plugin @nitpicker/analyze-axe --plugin @nitpicker/analyze-textlint)',
		},
		searchKeywords: {
			type: 'string',
			isMultiple: true,
			valueName: 'keyword',
			group: 'Analyze options',
			desc: 'Keywords for analyze-search plugin (overrides config file)',
		},
		searchScope: {
			type: 'string',
			valueName: 'selector',
			group: 'Analyze options',
			desc: 'CSS selector to narrow search scope for analyze-search plugin (overrides config file)',
		},
		axeLang: {
			type: 'string',
			valueName: 'lang',
			group: 'Analyze options',
			desc: 'BCP 47 language tag for analyze-axe plugin (overrides config file)',
		},
		// report flags
		sheet: {
			shortFlag: 'S',
			type: 'string',
			valueName: 'URL',
			group: 'Report options',
			desc: 'Google Sheets URL (enables the report step)',
		},
		credentials: {
			shortFlag: 'C',
			type: 'string',
			default: './credentials.json',
			valueName: 'path',
			group: 'Report options',
			desc: 'Path to credentials file (keep this file secure and out of version control)',
		},
		config: {
			shortFlag: 'c',
			type: 'string',
			valueName: 'path',
			group: 'Report options',
			desc: 'Path to config file',
		},
		dedupeResources: {
			type: 'boolean',
			default: true,
			group: 'Report options',
			desc: 'Collapse the Resources sheet by canonical URL (query values stripped) and add a Count column. Useful for archives dominated by per-request unique tracking-pixel URLs. Pass --no-dedupe-resources for one row per raw resource URL instead.',
		},
		// shared flags
		verbose: {
			type: 'boolean',
			desc: 'Output verbose log to standard out',
		},
		silent: {
			type: 'boolean',
			desc: 'No output log to standard out',
		},
	},
} as const satisfies CommandDef;
