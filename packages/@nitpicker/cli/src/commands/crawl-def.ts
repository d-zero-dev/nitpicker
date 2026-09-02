import type { CommandDef } from '@d-zero/roar';

/**
 * Command definition for the `crawl` sub-command.
 * Defines all CLI flags with their types, defaults, and descriptions.
 *
 * Split from `crawl.ts` (issue #294) so `cli.ts` can import this
 * lightweight flag/usage metadata eagerly for every command's `--help`
 * output, while the actual implementation — and everything it pulls in
 * (`@nitpicker/crawler`'s puppeteer-backed crawler) — loads lazily, only
 * for the command the user actually invoked. See `crawl.ts`'s `crawl`
 * function (dispatching to startCrawl/resumeCrawl/diff) for the main entry
 * point.
 */
export const commandDef = {
	desc: 'Crawl a website',
	usage: [
		'<URL> [<URL>...] [options]',
		'<archive> --append <URL> [--append <URL>...] [options]',
		'<archive> --retry-failed [options]',
		'<archive> --inventory <urls.txt> [options]',
		'<archive> --recrawl <urls.txt> [options]',
		'--resume <stub-dir> [options]',
		'--diff <archiveA> <archiveB>',
	],
	flags: {
		resume: {
			type: 'string',
			shortFlag: 'R',
			valueName: 'stub-dir',
			group: 'Crawl modes',
			desc: 'Resume an interrupted crawl from its stub file or temporary directory',
		},
		append: {
			type: 'string',
			shortFlag: 'A',
			isMultiple: true,
			valueName: 'URL',
			group: 'Crawl modes',
			desc: 'Append crawl: register the URL as a new recursive root for the positional archive (repeat for multiple URLs)',
		},
		retryFailed: {
			type: 'boolean',
			group: 'Crawl modes',
			desc: 'Retry crawl: re-fetch failed pages (missing status/content-type or a 5xx status) in the positional archive; use --no-recursive to skip re-crawling newly found URLs',
		},
		inventory: {
			type: 'string',
			valueName: 'file',
			group: 'Crawl modes',
			desc: "Inventory crawl: take a server-side URL list file and import only URLs that the positional archive does not yet track. The archive's --exclude / --exclude-url filters apply — matching URLs are recorded as skipped pages instead of being imported, same as excluded URLs in a normal crawl (--exclude-keyword still applies at render time, since it matches page content, not URLs). HTML URLs are rendered + recursively crawled; non-HTML URLs are stored directly without probing. Use with `query isolated-pages` / `unused-resources` to surface orphan pages / unused files.",
		},
		recrawl: {
			type: 'string',
			valueName: 'file',
			group: 'Crawl modes',
			desc: 'Recrawl: take a URL list file and re-fetch URLs that already exist as pages in the positional archive (reset to pending, then re-crawled — redirect sources, intentionally-skipped pages, and external pages are matched but not reset). URLs the archive does not yet track are imported the same way --inventory does, including its --exclude / --exclude-url handling. Re-run `analyze` afterward — reset pages have their prior findings cleared, but other analyze outputs are not selectively invalidated.',
		},
		single: {
			type: 'boolean',
			group: 'Crawl modes',
			desc: 'Crawl only the given URL without following links',
		},
		list: {
			type: 'string',
			isMultiple: true,
			valueName: 'URL',
			group: 'Crawl modes',
			desc: 'Crawl only the given page URLs (repeat for multiple URLs; disables recursion)',
		},
		listFile: {
			type: 'string',
			valueName: 'file',
			group: 'Crawl modes',
			desc: 'Crawl only the page URLs listed in the file, one per line (disables recursion)',
		},
		diff: {
			type: 'boolean',
			group: 'Crawl modes',
			desc: 'Compare two archives: write their internal page URL lists to a.txt / b.txt for use with diff tools',
		},
		recursive: {
			type: 'boolean',
			default: true,
			group: 'Scope & filtering',
			desc: 'Follow links found on crawled pages (use --no-recursive to disable)',
		},
		exclude: {
			type: 'string',
			isMultiple: true,
			valueName: 'glob',
			group: 'Scope & filtering',
			desc: 'Exclude page URL paths matching the glob pattern (repeatable)',
		},
		excludeKeyword: {
			type: 'string',
			isMultiple: true,
			valueName: 'keyword',
			group: 'Scope & filtering',
			desc: 'Exclude pages whose document contains the keyword (repeatable)',
		},
		excludeUrl: {
			type: 'string',
			isMultiple: true,
			valueName: 'prefix',
			group: 'Scope & filtering',
			desc: 'Exclude external URLs starting with the prefix (repeatable)',
		},
		disableQueries: {
			type: 'boolean',
			shortFlag: 'Q',
			group: 'Scope & filtering',
			desc: 'Strip query strings from URLs when crawling',
		},
		maxExcludedDepth: {
			type: 'number',
			group: 'Scope & filtering',
			desc: 'Maximum directory depth for excluded paths. Defaults to 10.',
		},
		dedupeCap: {
			type: 'number',
			default: 10,
			group: 'Scope & filtering',
			desc: 'Same-cluster soft cap: stop enqueueing newly-discovered internal URLs whose shape (e.g. `/news/date/{n}/`) has accumulated this many matching-title/description/og-tag observations. On by default (10) as a backstop against a site that keeps serving 2xx for a self-generating pager/query-parameter trap — false positives on legitimate large sections are structurally prevented (each such page differs in title/og tags, so the majority-vote counter never accumulates). Use --no-dedupe-cap (or --dedupeCap 0) to disable. See `query dedupe-cap-events` for what fired.',
		},
		dedupeMapCap: {
			type: 'number',
			group: 'Scope & filtering',
			desc: 'Hard cap on the number of distinct URL shapes --dedupe-cap tracks at once; the least-recently-touched shape is evicted beyond this. Only relevant when --dedupe-cap is enabled.',
		},
		interval: {
			type: 'number',
			shortFlag: 'I',
			valueName: 'ms',
			group: 'Fetch behavior',
			desc: 'Wait time in milliseconds between requests',
		},
		parallels: {
			type: 'number',
			shortFlag: 'P',
			group: 'Fetch behavior',
			desc: 'Number of pages to scrape in parallel',
		},
		retry: {
			type: 'number',
			default: 3,
			group: 'Fetch behavior',
			desc: 'Number of retry attempts per URL on scrape failure',
		},
		image: {
			type: 'boolean',
			default: true,
			group: 'Fetch behavior',
			desc: 'Capture image resources (use --no-image to disable)',
		},
		fetchExternal: {
			type: 'boolean',
			default: true,
			group: 'Fetch behavior',
			desc: 'Fetch external links (use --no-fetch-external to disable)',
		},
		imageFileSizeThreshold: {
			type: 'number',
			valueName: 'bytes',
			group: 'Fetch behavior',
			desc: 'File-size threshold above which images are excluded',
		},
		userAgent: {
			type: 'string',
			valueName: 'string',
			group: 'Fetch behavior',
			desc: 'Custom User-Agent string for HTTP requests',
		},
		ignoreRobots: {
			type: 'boolean',
			group: 'Fetch behavior',
			desc: 'Ignore robots.txt restrictions (use responsibly)',
		},
		skipTechnologyJsScan: {
			type: 'boolean',
			group: 'Fetch behavior',
			desc: 'Skip the post-crawl JS resource scan for technology license comments (avoids the extra network requests it makes against already-discovered JS resources)',
		},
		mainContentSelector: {
			type: 'string',
			valueName: 'selector',
			group: 'Fetch behavior',
			desc: 'CSS selector overriding automatic main-content-region detection',
		},
		output: {
			type: 'string',
			shortFlag: 'o',
			valueName: 'path',
			group: 'Output',
			desc: 'Output file path for the .nitpicker archive',
		},
		strict: {
			type: 'boolean',
			group: 'Output',
			desc: 'Treat external link errors as fatal (exit code 1 instead of 2)',
		},
		verbose: {
			type: 'boolean',
			group: 'Output',
			desc: 'Output verbose log to standard out',
		},
		silent: {
			type: 'boolean',
			group: 'Output',
			desc: 'No output log to standard out',
		},
	},
} as const satisfies CommandDef;
