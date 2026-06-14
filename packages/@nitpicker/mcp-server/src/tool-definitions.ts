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
			'Get site-wide overview. Returns: internal/external HTML page counts (`internalPages` / `externalPages`), internal/external content-row counts across every MIME (`internalContents` / `externalContents` — HTML + PDF + Office docs + CSVs + archives + ...), HTTP status distribution, Content-Type distribution over 18 categories (html, pdf, csv, word, excel, powerpoint, image, css, javascript, json+yaml, xml, font, audio, video, archive, text, other, unknown), and metadata fulfillment rates (title, description, OG tags) for internal HTML pages only. `internalContents` is always >= `internalPages` (the latter applies the historical HTML-or-null filter, the former does not). Use this first to understand the archive contents.',
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
			'List pages with rich filtering: by status code (exact or range), missing metadata (title, description), noindex flag, URL patterns, directory paths. Supports sorting and pagination. Use for questions like "show me all 404 pages" or "pages without descriptions".',
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
			'Get full details for a specific page URL: all metadata (title, description, OG, Twitter), outbound links, inbound links, redirects, response headers. Use when drilling down into a specific page.',
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
			'Analyze links: find broken links (4xx/5xx status), external links, or orphaned pages (no incoming links). Use for link health checks and site structure analysis.',
		inputSchema: {
			type: 'object' as const,
			properties: {
				archiveId: {
					type: 'string',
					description: 'The archive ID returned by open_archive',
				},
				type: {
					type: 'string',
					enum: ['broken', 'external', 'orphaned'],
					description:
						'Type of link analysis: broken (4xx/5xx), external, or orphaned (no inbound links)',
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
				limit: { type: 'number', description: 'Max results (default: 100)' },
				offset: { type: 'number', description: 'Results to skip (default: 0)' },
			},
			required: ['archiveId'],
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
			},
			required: ['archiveId', 'type'],
		},
	},
	{
		name: 'get_resource_referrers',
		description:
			'Find which pages reference a specific resource (CSS, JS, image). Useful for impact analysis when considering removal or updates of a resource.',
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
			},
			required: ['archiveId', 'resourceUrl'],
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
];
