import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * All MCP tool definitions for the Nitpicker archive query server.
 * Each tool includes a name, description with LLM guidance, and JSON Schema
 * for its input parameters.
 */
export const toolDefinitions: Tool[] = [
	{
		name: 'open_archive',
		description:
			'Load a Nitpicker archive source for querying. Accepts either a finished `.nitpicker` archive file OR a crawl stub directory (an `._nitpicker-*` working directory left behind when a crawl is interrupted). Returns an archiveId, the detected `mode` (`"archive"` or `"stub"`), and `crawlerPid` (the PID of a crawler currently writing the stub, or `null` for finished archives and interrupted-but-no-longer-running crawls). When `mode === "stub"`, treat the data as a point-in-time snapshot: any counts/violations may shift if the user resumes the crawl. Always call this first before using any other tools.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				filePath: {
					type: 'string',
					description:
						'Absolute or relative path to a `.nitpicker` archive file OR a crawl stub directory (containing `db.sqlite`).',
				},
			},
			required: ['filePath'],
		},
	},
	{
		name: 'close_archive',
		description: 'Close a previously opened archive and release its resources.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'get_summary',
		description:
			'Get site-wide overview. Returns: internal/external HTML page counts (`internalPages` / `externalPages`), internal/external content-row counts across every MIME (`internalContents` / `externalContents` — HTML + PDF + Office docs + CSVs + archives + ...), HTTP status distribution, Content-Type distribution over 18 categories (html, pdf, csv, word, excel, powerpoint, image, css, javascript, json+yaml, xml, font, audio, video, archive, text, other, unknown), and metadata fulfillment rates (title, description, OG tags) for internal HTML pages only. Every page/content count and the Content-Type distribution exclude `status = 404` rows (no page exists behind a 404 URL); 404s appear only in the status distribution, split into a plain `404` row (fix-target broken pages) and a trailing `inventorySeed: true` row (`crawl --inventory` input mistakes). The metadata denominator excludes only the inventory-seed 404s. `internalContents` is always >= `internalPages` (the latter applies the historical HTML-or-null filter, the former does not). Use this first to understand the archive contents.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'list_pages',
		description:
			'List pages with rich filtering: by status code (exact or range), missing metadata (title, description), noindex flag, security header presence (CSP / X-Frame-Options / X-Content-Type-Options / HSTS), dedupe-cap trap membership, URL patterns, directory paths. Supports sorting and pagination. Use for questions like "show me all 404 pages", "pages without descriptions", "internal pages missing CSP", or "which pages got swept up in a --dedupe-cap trap". For large sites, set `limit` to keep the response bounded — to dump the whole list use the CLI (`nitpicker query pages`) and pipe through `jq` instead of pulling everything through MCP.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				status: { type: 'number', description: 'Filter by exact HTTP status code' },
				statusMin: {
					type: 'number',
					description: 'Filter by minimum status code (inclusive)',
				},
				statusMax: {
					type: 'number',
					description: 'Filter by maximum status code (inclusive)',
				},
				isExternal: {
					type: 'boolean',
					description: 'Filter by external (true) or internal (false)',
				},
				missingTitle: { type: 'boolean', description: 'Filter to pages missing title' },
				missingDescription: {
					type: 'boolean',
					description: 'Filter to pages missing description',
				},
				noindex: { type: 'boolean', description: 'Filter to pages with noindex set' },
				isDedupeCapped: {
					type: 'boolean',
					description:
						'Filter to pages whose URL shape --dedupe-cap captured as a same-cluster crawl trap during crawl (see dedupe_cap_events)',
				},
				dedupeCapEventId: {
					type: 'number',
					description:
						'Filter to pages captured by one specific dedupe_cap_events row (its id) — see list_dedupe_cap_events',
				},
				hasCSP: {
					type: 'boolean',
					description: 'Filter by Content-Security-Policy header presence',
				},
				hasXFrameOptions: {
					type: 'boolean',
					description: 'Filter by X-Frame-Options header presence',
				},
				hasXContentTypeOptions: {
					type: 'boolean',
					description: 'Filter by X-Content-Type-Options header presence',
				},
				hasHSTS: {
					type: 'boolean',
					description: 'Filter by Strict-Transport-Security header presence',
				},
				contentTypeCategory: {
					type: 'string',
					enum: [
						'html',
						'pdf',
						'csv',
						'word',
						'excel',
						'powerpoint',
						'image',
						'css',
						'javascript',
						'json',
						'xml',
						'font',
						'audio',
						'video',
						'archive',
						'text',
						'other',
						'unknown',
					],
					description:
						'Restrict to one Content-Type category. When set, the default HTML-or-null base filter is relaxed so non-HTML categories (PDF, image, archive…) become reachable through this listing — useful for audits like "show every PDF in scope". csv groups .csv + .tsv; word groups .doc + .docx; excel groups .xls + .xlsx; powerpoint groups .ppt + .pptx; json groups JSON + YAML; text groups .txt + .md.',
				},
				urlPattern: {
					type: 'string',
					description: 'URL pattern to search (SQL LIKE: use % as wildcard)',
				},
				directory: { type: 'string', description: 'Directory path prefix to filter by' },
				sortBy: {
					type: 'string',
					enum: ['url', 'status', 'title'],
					description: 'Field to sort by',
				},
				sortOrder: {
					type: 'string',
					enum: ['asc', 'desc'],
					description: 'Sort direction',
				},
				limit: { type: 'number', description: 'Max results to return (default: 100)' },
				offset: { type: 'number', description: 'Number of results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'get_page_detail',
		description:
			"Get full details for a specific page URL: ~47 flat meta fields (title, description, OG, Twitter, robots, link, charset, manifest, themeColor, fb_app_id, verification_google, format_detection, og:image:alt/width/height, og:locale, og:article timestamps, twitter:site/creator, etc.), `metaExtras` JSON (referrer, viewport parsed, httpEquiv, apple, msapplication, verification.{bing|yandex|...}, geo, citation, hreflang alternates, others.*, originTrial), JSON-LD/SpeculationRules **summary** (count + unique @types + parseErrorCount), Wappalyzer tag **summary** (count + provider→ids map), main-content **aggregate counts only** (mainContentSelector, mainContentWordCount/BodyWordCount, mainContentHeadingCount/ImageCount/TableCount/ButtonCount/IframeCount/VideoCount/AudioCount/CanvasCount, scrollHeightDesktop/Mobile — null when the page was never rendered), outbound links, redirect sources, response headers, `isDedupeCapped`/`dedupeCapShapeKey` (whether --dedupe-cap captured this page's URL shape as a same-cluster crawl trap, and which shape), and within-archive timestamps (firstCrawledAt / lastCrawledAt). Inbound links are NOT included here — a page's referrer count can reach the hundreds of thousands on a large site; use `list_inbound_links` instead. Raw JSON-LD entries, full tag rows, and the main-content child-entity arrays are also NOT included — fetch them via `get_page_jsonld` / `get_page_tags` / `get_page_main_contents`. Use when drilling down into a specific page.",
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				url: { type: 'string', description: 'The exact URL of the page to retrieve' },
			},
			required: ['archiveId', 'url'],
		},
	},
	{
		name: 'list_inbound_links',
		description:
			"Find which pages link to a specific page — the reverse of the page's outbound links. Results are bounded and cursor-paginated (default 100 per call) — pass the returned `nextCursor` back in to fetch the rest for a page linked from many pages. Redirect sources and URL-normalization aliases resolve to their canonical page, the same resolution `get_page_detail` applies. Pass `limit: 0` to get only the total referrer count without any rows.",
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				url: {
					type: 'string',
					description: 'The exact URL of the page whose inbound links to list',
				},
				limit: {
					type: 'number',
					description: 'Max referring pages (default: 100; 0 for count only)',
				},
				cursor: {
					type: 'string',
					description: 'Opaque cursor from a previous call, taken from its `nextCursor`',
				},
			},
			required: ['archiveId', 'url'],
		},
	},
	{
		name: 'get_page_html',
		description:
			'Retrieve the saved HTML snapshot of a page. Returns the raw HTML content. Use maxLength to limit size for large pages. Useful for inspecting actual page structure and content.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				url: {
					type: 'string',
					description: 'The exact URL of the page whose HTML to retrieve',
				},
				maxLength: {
					type: 'number',
					description: 'Max characters to return (default: 100000)',
				},
			},
			required: ['archiveId', 'url'],
		},
	},
	{
		name: 'list_links',
		description:
			'Analyse links: find **broken** links (canonical destination is exactly HTTP 404 Not Found — 403 Forbidden, 5xx server errors, and destinations excluded from crawling are deliberately NOT counted as broken, since those are separate concerns) or **external** links. Anchor destinations are resolved through `pages.redirectDestId` to the canonical final destination before judgment, so a 301 intermediate that lands on a 404 reports as broken with the 404 URL — not as a stale 301. Pass `includeRedirectSources: true` to disable the resolution and see the literal anchor target (diagnostic view). For orphan analysis, use `list_isolated_pages` (singletons) or `list_isolated_clusters` (interconnected orphan groups) — the previous `orphaned` type was removed in favour of those two well-separated concepts.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				type: {
					type: 'string',
					enum: ['broken', 'external'],
					description:
						'Type of link analysis: broken (canonical destination is exactly HTTP 404) or external (anchor leaves the in-scope hostname). Judged against the redirect-resolved canonical destination by default.',
				},
				includeRedirectSources: {
					type: 'boolean',
					description:
						'When true, skip the redirect resolution and judge against the literal anchor target. Diagnostic — default is false.',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId', 'type'],
		},
	},
	{
		name: 'list_resources',
		description:
			'List sub-resources (CSS, JS, images, fonts) with filtering by content type and origin. Shows compression and CDN status. Use for tech stack analysis, library detection (jQuery, React), and performance checks.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				contentType: {
					type: 'string',
					description:
						'Filter by content type prefix (e.g., "text/css", "application/javascript")',
				},
				isExternal: {
					type: 'boolean',
					description: 'Filter by external (true) or internal (false)',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'list_images',
		description:
			'List images with quality checks: missing alt text, missing width/height dimensions, oversized images (exceeding threshold). Use for accessibility and performance auditing.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				missingAlt: {
					type: 'boolean',
					description: 'Filter to images missing alt attribute',
				},
				missingDimensions: {
					type: 'boolean',
					description: 'Filter to images missing width/height',
				},
				oversizedThreshold: {
					type: 'number',
					description:
						'Filter to images with naturalWidth or naturalHeight exceeding this pixel count',
				},
				urlPattern: {
					type: 'string',
					description: 'Filter source URLs by pattern (SQL LIKE)',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'get_violations',
		description:
			'Get analysis violations from plugins (axe, markuplint, textlint, lighthouse). Filter by validator, severity, or rule. Use for accessibility and code quality reports.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				validator: {
					type: 'string',
					description:
						'Filter by validator name (e.g., "axe", "markuplint", "textlint", "lighthouse")',
				},
				severity: { type: 'string', description: 'Filter by severity level' },
				rule: { type: 'string', description: 'Filter by rule ID' },
				urlPattern: {
					type: 'string',
					description: 'Filter URLs by SQL LIKE pattern',
				},
				sortBy: {
					type: 'string',
					enum: ['url', 'validator', 'severity', 'rule', 'message', 'code'],
					description: 'Sort field',
				},
				sortOrder: {
					type: 'string',
					enum: ['asc', 'desc'],
					description: 'Sort direction',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'list_console_logs',
		description:
			'List distinct console messages / page errors captured during the crawl, aggregated across every page they occurred on. Each entry reports pageCount (distinct pages) and totalCount (total occurrences) — the same message logged by a shared framework on many pages collapses to one entry. Filter by type (e.g. "error", "warn", "pageerror" for uncaught exceptions). Use for finding site-wide JS errors.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				type: {
					type: 'string',
					description:
						'Filter by console message type (e.g. "log", "warn", "error", "pageerror" for uncaught exceptions)',
				},
				sortBy: {
					type: 'string',
					enum: ['totalCount', 'pageCount', 'text', 'type'],
					description: 'Sort field (default: totalCount)',
				},
				sortOrder: {
					type: 'string',
					enum: ['asc', 'desc'],
					description: 'Sort direction (default: desc)',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'get_page_console_logs',
		description:
			'Get every console message / page error captured for a single page, in capture order. Includes args, source location, and stack trace (for "pageerror" entries).',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				url: { type: 'string', description: 'The page URL' },
			},
			required: ['archiveId', 'url'],
		},
	},
	{
		name: 'find_duplicates',
		description:
			'Find pages with identical title or description. Detects SEO issues where multiple pages share the same metadata. Use for deduplication audits.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				field: {
					type: 'string',
					enum: ['title', 'description'],
					description: 'Metadata field to check for duplicates (default: "title")',
				},
				limit: { type: 'number', description: 'Max duplicate groups (default: 50)' },
				offset: { type: 'number', description: 'Duplicate groups to skip (default: 0)' },
				pagesLimit: {
					type: 'number',
					description: 'Max inline sample URLs per duplicate group (default: 20)',
				},
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'find_duplicate_bodies',
		description:
			'Find pages whose rendered <body> content is byte-identical after masking dynamic ids and /index.{ext} URL-suffix variance. Unlike find_duplicates (which compares title/description metadata), this compares actual page content — use it to catch server-side URL normalization gaps, http/https or path-variant duplicate crawls, and pages that dynamically render identical content under different URLs, regardless of HTTP status or hostname.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				limit: { type: 'number', description: 'Max duplicate groups (default: 50)' },
				offset: { type: 'number', description: 'Duplicate groups to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'find_mismatches',
		description:
			'Find metadata mismatches: canonical URL ≠ page URL, og:title ≠ title, og:description ≠ description. Use for SEO consistency checks.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				type: {
					type: 'string',
					enum: ['canonical', 'og:title', 'og:description'],
					description:
						'Type of mismatch: canonical (canonical≠URL), og:title (og:title≠title), og:description (og:description≠description)',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
				urlPattern: {
					type: 'string',
					description: 'SQL LIKE pattern to filter results by page URL',
				},
				sortBy: {
					type: 'string',
					enum: ['url', 'actual', 'expected'],
					description: 'Field to sort results by (default: "url")',
				},
				sortOrder: {
					type: 'string',
					enum: ['asc', 'desc'],
					description: 'Sort direction (default: "asc")',
				},
			},
			required: ['archiveId', 'type'],
		},
	},
	{
		name: 'get_resource_referrers',
		description:
			'Find which pages reference a specific resource (CSS, JS, image). Useful for impact analysis when considering removal or updates of a resource. Results are bounded and cursor-paginated (default 100 per call) — pass the returned `nextCursor` back in to fetch the rest for a resource referenced by many pages.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				resourceUrl: {
					type: 'string',
					description: 'The exact URL of the resource to look up',
				},
				limit: { type: 'number', description: 'Max referring pages (default: 100)' },
				cursor: {
					type: 'string',
					description: 'Opaque cursor from a previous call, taken from its `nextCursor`',
				},
			},
			required: ['archiveId', 'resourceUrl'],
		},
	},
	{
		name: 'list_pages_by_tag',
		description:
			'List pages that have a Wappalyzer-detected tag matching the given `provider` (and optionally a specific `externalId` like a GTM container ID or GA4 measurement ID). Returns the same shape as `list_pages`. Before pulling the full list, consider calling `count_pages_by_tag` to size-check — on a large site GTM may cover most pages and the response can run into MB. For full bulk extraction prefer the CLI: `nitpicker query pages-by-tag --provider "Google Tag Manager" | jq`.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				provider: {
					type: 'string',
					description:
						'Wappalyzer provider name (e.g. "Google Tag Manager", "Google Analytics 4")',
				},
				externalId: {
					type: 'string',
					description:
						'Optional external identifier extracted from the page (GTM-XXXX / G-XXXX / …). Omit for any.',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId', 'provider'],
		},
	},
	{
		name: 'count_pages_by_tag',
		description:
			'Lightweight count-only sibling of `list_pages_by_tag`. Returns `{ pageCount }` for the given provider (and optional `externalId`). Use this to size-check before fetching the full list.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				provider: { type: 'string', description: 'Wappalyzer provider name' },
				externalId: {
					type: 'string',
					description: 'Optional external identifier (GTM-XXXX / G-XXXX / …)',
				},
			},
			required: ['archiveId', 'provider'],
		},
	},
	{
		name: 'list_pages_by_jsonld_type',
		description:
			'List pages with at least one JSON-LD entry having the given top-level `@type` (e.g. "Product", "BreadcrumbList", "FAQPage"). Returns the same shape as `list_pages`. Before pulling the full list, consider calling `count_pages_by_jsonld_type` — on an e-commerce site "Product" may match thousands of pages. For full bulk extraction prefer the CLI: `nitpicker query pages-by-jsonld-type --type Product | jq`.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				type: {
					type: 'string',
					description: 'Top-level JSON-LD `@type` value to filter by (e.g. "Product")',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId', 'type'],
		},
	},
	{
		name: 'count_pages_by_jsonld_type',
		description:
			'Lightweight count-only sibling of `list_pages_by_jsonld_type`. Returns `{ pageCount }` for the given JSON-LD `@type`. Use to size-check before fetching the full list.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				type: { type: 'string', description: 'Top-level JSON-LD `@type` value' },
			},
			required: ['archiveId', 'type'],
		},
	},
	{
		name: 'get_tag_inventory',
		description:
			'Returns the site-wide Wappalyzer technology inventory: one entry per detected provider, with the count of distinct pages where it was found, sorted by page count desc. Use as a "what tech does this site use?" answer for audit kick-offs. On 1M-page archives this can be MB-sized; for bulk consumption prefer the CLI: `nitpicker query tag-inventory | jq`.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'get_page_jsonld',
		description:
			'Returns the JSON-LD / SpeculationRules entries for a page. Defaults to `slim=true` which omits the `raw` JSON text and the `parsed` object — only `kind`, `type`, `rawByteSize`, and `parseError` are returned per entry. Use `slim=false` for full raw payload, but be aware: an e-commerce product page can have 50 schemas × 50KB each. Before requesting `slim=false`, call `get_page_jsonld_overview` to see entry sizes. For full raw bulk extraction prefer the CLI: `nitpicker query page-jsonld --url <URL> --full | jq`.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				url: { type: 'string', description: 'The page URL' },
				slim: {
					type: 'boolean',
					description:
						'Omit `raw` and `parsed` (default true). Set to false for full payload.',
				},
			},
			required: ['archiveId', 'url'],
		},
	},
	{
		name: 'get_page_jsonld_overview',
		description:
			'Lightweight overview of a page\'s JSON-LD: one entry per `<script type="application/ld+json">` or `<script type="speculationrules">` with `kind`, `type`, `rawByteSize`, and `parseError`. Designed as the "metadata before data" probe — see total bytes before fetching the full payload via `get_page_jsonld(slim=false)`.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				url: { type: 'string', description: 'The page URL' },
			},
			required: ['archiveId', 'url'],
		},
	},
	{
		name: 'get_page_tags',
		description:
			'Returns the Wappalyzer tag rows for a page (one per provider × external-id), with `categories`, `version`, `confidence`, and `sources` preserved. Use after `get_page_detail` returned a tags summary and you need provider details. Bounded payload (KB-scale per page); no slim mode needed.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				url: { type: 'string', description: 'The page URL' },
			},
			required: ['archiveId', 'url'],
		},
	},
	{
		name: 'get_page_main_contents',
		description:
			'Returns the detected main-content region for a page: its identity (nodeName, id, classList, role, a diagnostic selector), aggregate counts already available via get_page_detail (wordCount, bodyWordCount, scrollHeight at desktop/mobile), and full drill-down for all 8 child-entity arrays in DOM order - headings (text + level), images (src + alt), tables (rows/cols/hasHeader/hasFooter/hasMergedCell), buttons (nodeName/role/type/text/disabled), iframes (src/title/width/height), videos (src/poster/width/height), audios (src), canvases (width/height). Returns null only when the page was never rendered (external page, failed scrape). When the page was rendered but beholder found no main-content element, returns a full object with `main: null`, empty child arrays, and `wordCount: 0` (bodyWordCount and scrollHeight still reflect the whole document, since those are measured independently of main-region detection). Use after get_page_detail when you need the actual entries, not just the counts.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				url: { type: 'string', description: 'The page URL' },
			},
			required: ['archiveId', 'url'],
		},
	},
	{
		name: 'check_headers',
		description:
			'Check security HTTP headers (CSP, X-Frame-Options, X-Content-Type-Options, HSTS) for internal pages. Use missingOnly=true to find pages lacking security headers.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				missingOnly: {
					type: 'boolean',
					description: 'Only return pages missing at least one security header',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'list_isolated_pages',
		description:
			'List **完全孤立** — inventory-* HTML pages that form singleton components in the inventory subgraph (no resolved-anchor inbound from any other inventory-* node). `source` is typically `inventory-seed`, but an `inventory-discovered` row can also surface here if its discoverer was later demoted to `crawled` (the crawled-wins downgrade). `crawled` rows never appear here by definition — that label asserts "reachable via the recursive crawl chain", which excludes orphan status. For interconnected orphan groups (size ≥ 2), use `list_isolated_clusters` instead.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'list_isolated_clusters',
		description:
			"List **孤立集合** — connected components of the inventory-* subgraph with size ≥ 2. Each cluster is identified by `representativeUrl` (the lexicographically smallest member URL), with `size` and the representative member's title/status for at-a-glance scanning. Sort: size DESC, representativeUrl ASC. Follow up with `get_isolated_cluster` to fetch the full member list of a specific cluster. Singletons are reported by `list_isolated_pages`; cluster listing omits them so the operator sees interconnected orphan groups (typical: date-series archive pages, paginated category indexes, etc.) without singleton noise.",
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				limit: { type: 'number', description: 'Max clusters to return (default: 100)' },
				offset: { type: 'number', description: 'Clusters to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'get_isolated_cluster',
		description:
			"Fetch the full member list of one isolated cluster, identified by its `representativeUrl` (from `list_isolated_clusters`). Returns null when no cluster matches — typically because a follow-up crawl reached one of the cluster's members via the crawled chain, demoting the inventory-* labels and collapsing the cluster. Members are sorted by URL ASC, so `members[0].url === representativeUrl` is invariant.",
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				representativeUrl: {
					type: 'string',
					description:
						"The cluster's representative URL (returned by list_isolated_clusters).",
				},
			},
			required: ['archiveId', 'representativeUrl'],
		},
	},
	{
		name: 'list_unused_resources',
		description:
			'List internal sub-resources that no archived page references — candidates for deletion from the server. Each row carries a `source` badge so callers can distinguish files registered via `crawl --inventory` (no page ever loaded them) from files that were once referenced but lost their last referrer.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'list_network_outages',
		description:
			'List recorded operator-network outages — periods where the crawl operator\'s own connectivity, not the target sites, was suspected down and worker fetches were paused. Each row has `started_at` / `ended_at` (epoch ms; `ended_at` is never null — a row left open by a crashed session resolves to the archive\'s last observed activity) and the trigger evidence (`probe_host`, `trigger_error_count`, `trigger_host_count`). Use this to distinguish "this page failed because the target site is down" from "this page failed because our own network was down at the time" — the latter is retried automatically by `crawl --retry-failed` even though its error message classifies as a normally-permanent kind (e.g. `dns`).',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'find_duplicate_clusters',
		description:
			'Find same-`body_hash` clusters filtered and ranked for "is this a self-generating crawl trap" (a pager/query-parameter loop the crawler kept following, e.g. `/news/date/{n}/`) — the curated counterpart of find_duplicate_bodies. Filters to clusters at or above minCount with a uniform title across every member page, and ranks by ogUrlMismatchRatio (share of members whose og:url points elsewhere, typically the parent listing) then cluster size. Each result includes a bounded samplePages list and a commonDirectories frequency distribution computed from the full member set.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				minCount: {
					type: 'number',
					description: 'Minimum cluster size to include (default: 10)',
				},
				limit: { type: 'number', description: 'Max clusters (default: 50)' },
				offset: { type: 'number', description: 'Clusters to skip (default: 0)' },
				samplePagesLimit: {
					type: 'number',
					description: 'Max inline sample URLs per cluster (default: 20)',
				},
			},
			required: ['archiveId'],
		},
	},
	{
		name: 'list_dedupe_cap_events',
		description:
			'List recorded same-cluster-cap audit rows: URL shapes (e.g. `example.com/news/date/{n}/`) that the opt-in `--dedupe-cap` crawl flag confirmed as self-generating traps and stopped enqueueing further anchors for. Each row has the shape key, a sample URL, the effective threshold that triggered the cap (after halving for confidence signals), the observed count, when it was detected, and rejected_count (anchors rejected afterward — null if the crawl never reached crawlEnd).',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
		},
	},
];
