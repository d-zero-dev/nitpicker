import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `pipeline` sub-command.
 * Merges flags from crawl and report into a single command
 * that executes the full crawl → report workflow sequentially.
 *
 * Split from `pipeline.ts` (issue #294) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation — which statically imports
 * `crawl.ts`/`report.ts` (it genuinely needs both to run
 * the combined workflow) — loads lazily, only for the command the user
 * actually invoked. See `pipeline.ts`'s `pipeline` function for the main
 * entry point.
 */
// TODO: フラグ定義が crawl.ts / report.ts と重複している。
// @d-zero/roar の CommandDef 型制約により合成が困難なため手動同期が必要。
// crawl / report にフラグを追加・変更した際はここも更新すること。
export const commandDef = {
	desc: 'Run crawl → report sequentially',
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
		header: {
			type: 'string',
			isMultiple: true,
			valueName: 'name: value',
			group: 'Crawl options',
			desc: 'Extra request header, curl -H style (repeatable). Sent only to in-scope URLs — never to external hosts or redirects that leave the scope. The value is never stored in the archive; re-supply it on --resume/--append/--retry-failed/--recrawl/--inventory. Prefer --header-file to keep secrets out of shell history',
		},
		authorization: {
			type: 'string',
			valueName: 'value',
			group: 'Crawl options',
			desc: 'Shorthand for --header "Authorization: <value>" (e.g. "Bearer <token>"). Same scope and storage rules as --header',
		},
		headerFile: {
			type: 'string',
			valueName: 'path',
			group: 'Crawl options',
			desc: 'File of extra request headers, one "Name: value" per line (blank lines and # comments ignored). Same scope and storage rules as --header',
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
		skipTemplates: {
			type: 'boolean',
			group: 'Crawl options',
			desc: 'Skip the page template classification (DOM-structure clustering into per-site templates) that otherwise runs at the end of the crawl; run it later with `viewer-build`',
		},
		// report flags
		all: {
			type: 'boolean',
			group: 'Report options',
			desc: 'Generate all report sheets without interactive prompt',
		},
		sheet: {
			shortFlag: 'S',
			type: 'string',
			valueName: 'URL',
			group: 'Report options',
			desc: 'Google Sheets URL, or a Drive folder URL to create a new Spreadsheet (enables the report step)',
		},
		credentials: {
			shortFlag: 'C',
			type: 'string',
			valueName: 'path',
			group: 'Report options',
			desc: 'Path to credentials file. When omitted, falls back to the GOOGLE_AUTH_CREDENTIALS environment variable, then ./credentials.json if it exists, then Application Default Credentials (keep this file secure and out of version control)',
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
