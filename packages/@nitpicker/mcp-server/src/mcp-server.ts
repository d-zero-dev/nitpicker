import type { TechnologySignalEntry } from '@nitpicker/query';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
	ArchiveManager,
	countPagesByJsonLdType,
	countPagesByTechnology,
	findDuplicateBodies,
	getDuplicatesFastPath,
	getHeaderChecksFastPath,
	getImagesFastPath,
	getIsolatedClusterFastPath,
	getMismatchesFastPath,
	getPageConsoleLogs,
	getPageDetail,
	getPageHtml,
	getPageJsonLd,
	getPageJsonLdOverview,
	getPageMainContents,
	getPageTechnologies,
	getResourceReferrers,
	getSummaryFastPath,
	getTechnologyInventoryFastPath,
	getViolations,
	listConsoleLogs,
	listDedupeCapEvents,
	listDuplicateBodyClusters,
	listInboundLinks,
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

import { toolDefinitions } from './tool-definitions.js';

/**
 * Validates that a required string argument is present and returns it.
 * @param args - The arguments object.
 * @param key - The argument key to validate.
 * @returns The validated string value.
 * @throws {Error} If the argument is missing or not a string.
 */
function requireString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	if (typeof value !== 'string' || value === '') {
		throw new Error(`Missing required argument: ${key}`);
	}
	return value;
}

/**
 * Extracts an optional number argument with validation.
 * @param args - The arguments object.
 * @param key - The argument key.
 * @returns The number value, or undefined if not present.
 * @throws {Error} If the value is present but not a valid number.
 */
function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	if (value == null) {
		return undefined;
	}
	const num = Number(value);
	if (Number.isNaN(num)) {
		throw new TypeError(`Invalid number for argument: ${key}`);
	}
	return num;
}

/**
 * Validates an optional boolean argument, coercing common string forms
 * (`"true"` / `"false"`) so LLM clients that JSON-encode tool arguments
 * don't silently fall into the truthy-string trap (`"false"` being truthy
 * would otherwise flip a diagnostic flag on when the caller asked it off).
 * @param args - The MCP tool-call arguments object.
 * @param key - The argument key.
 * @returns The boolean value, or `undefined` if not present.
 * @throws {TypeError} If the value is present but not a boolean / coercible string.
 */
function optionalBoolean(
	args: Record<string, unknown>,
	key: string,
): boolean | undefined {
	const value = args[key];
	if (value == null) {
		return undefined;
	}
	if (typeof value === 'boolean') {
		return value;
	}
	if (value === 'true') {
		return true;
	}
	if (value === 'false') {
		return false;
	}
	throw new TypeError(`Invalid boolean for argument: ${key}`);
}

/**
 * Extracts an optional string argument with validation.
 * @param args - The arguments object.
 * @param key - The argument key.
 * @returns The string value, or `undefined` if not present.
 * @throws {TypeError} If the value is present but not a string.
 */
function optionalString(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	if (value == null) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new TypeError(`Invalid string for argument: ${key}`);
	}
	return value;
}

/** Valid link analysis types. */
const VALID_LINK_TYPES = ['broken', 'external'] as const;

/** Valid mismatch types. */
const VALID_MISMATCH_TYPES = ['canonical', 'og:title', 'og:description'] as const;

/** Valid duplicate check fields. */
const VALID_DUPLICATE_FIELDS = ['title', 'description'] as const;

/**
 * Validates that a string argument is one of the allowed values.
 * @param value - The string value to validate.
 * @param allowed - The list of allowed values.
 * @param label - A label for the argument (used in error messages).
 * @returns The validated value cast to the correct type.
 * @throws {Error} If the value is not in the allowed list.
 */
function validateEnum<T extends string>(
	value: string,
	allowed: readonly T[],
	label: string,
): T {
	if (!(allowed as readonly string[]).includes(value)) {
		throw new Error(
			`Invalid ${label}: "${value}". Must be one of: ${allowed.join(', ')}`,
		);
	}
	return value as T;
}

/**
 * Returns a shallow copy of args with the specified keys removed.
 * @param args - The arguments object.
 * @param keys - The keys to exclude.
 * @returns A new object without the specified keys.
 */
function omit(args: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		if (!keys.includes(key)) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Creates and configures the Nitpicker MCP server with all tools registered.
 * Uses the low-level Server API to avoid deep type instantiation issues
 * with McpServer + Zod schemas.
 * @returns The configured Server instance. Connect it to a transport to start serving.
 * @example
 * ```ts
 * import { createServer } from '@nitpicker/mcp-server';
 * import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
 *
 * const server = createServer();
 * await server.connect(new StdioServerTransport());
 * ```
 */
export function createServer() {
	// Route ArchiveManager warnings to stderr explicitly via process.stderr.write
	// instead of `console.warn`, but more importantly: do NOT let them leak into
	// `process.stdout`, which is reserved for JSON-RPC framing on MCP stdio.
	// `console.warn` already writes to stderr on Node, but going through onWarn
	// gives us a single chokepoint to silence/redirect (e.g. when an MCP host
	// surfaces stderr to the user as red error banners).
	const manager = new ArchiveManager({
		onWarn: (message) => {
			process.stderr.write(`${message}\n`);
		},
	});
	const server = new Server(
		{ name: 'nitpicker', version: '0.13.0' },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, () =>
		Promise.resolve({ tools: toolDefinitions }),
	);

	server.setRequestHandler(
		CallToolRequestSchema,
		async (
			request,
		): Promise<{
			content: { type: 'text'; text: string }[];
			isError?: boolean;
		}> => {
			const { name } = request.params;
			const args = request.params.arguments ?? {};

			try {
				switch (name) {
					case 'open_archive': {
						const filePath = requireString(args, 'filePath');
						const { archiveId, accessor, mode, crawlerLockHolder } =
							await manager.open(filePath);
						const summary = await getSummaryFastPath(accessor);
						return jsonResult({
							archiveId,
							baseUrl: summary.baseUrl,
							roots: summary.roots,
							totalPages: summary.totalPages,
							// Surface the source kind so an LLM caller knows whether
							// the data is finalised or a moving snapshot.
							mode,
							// PID of a crawler currently writing the stub (when
							// detectable). `null` for finished archives and
							// interrupted-but-no-longer-running crawls.
							crawlerPid: crawlerLockHolder?.alive ? crawlerLockHolder.pid : null,
						});
					}
					case 'close_archive': {
						const archiveId = requireString(args, 'archiveId');
						await manager.close(archiveId);
						return textResult('Archive closed successfully.');
					}
					case 'get_summary': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await getSummaryFastPath(accessor));
					}
					case 'list_pages': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await listPages(accessor, omit(args, 'archiveId')));
					}
					case 'get_page_detail': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const url = requireString(args, 'url');
						const result = await getPageDetail(accessor, url);
						if (!result) {
							return textResult('Page not found.');
						}
						return jsonResult(result);
					}
					case 'list_inbound_links': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const url = requireString(args, 'url');
						const result = await listInboundLinks(accessor, {
							url,
							limit: optionalNumber(args, 'limit'),
							cursor: optionalString(args, 'cursor'),
						});
						if (!result) {
							return textResult('Page not found.');
						}
						return jsonResult(result);
					}
					case 'get_page_html': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const url = requireString(args, 'url');
						const maxLength = optionalNumber(args, 'maxLength');
						const result = await getPageHtml(accessor, url, maxLength);
						if (!result) {
							return textResult('HTML snapshot not found.');
						}
						const text = result.truncated
							? `[Truncated to ${maxLength ?? 100_000} chars]\n${result.html}`
							: result.html;
						return textResult(text);
					}
					case 'list_links': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const type = validateEnum(
							requireString(args, 'type'),
							VALID_LINK_TYPES,
							'link type',
						);
						return jsonResult(
							await listLinks(accessor, {
								type,
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
								includeRedirectSources: optionalBoolean(args, 'includeRedirectSources'),
							}),
						);
					}
					case 'list_resources': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await listResources(accessor, omit(args, 'archiveId')));
					}
					case 'list_images': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await getImagesFastPath(accessor, omit(args, 'archiveId')));
					}
					case 'get_violations': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await getViolations(accessor, {
								validator: optionalString(args, 'validator'),
								severity: optionalString(args, 'severity'),
								rule: optionalString(args, 'rule'),
								urlPattern: optionalString(args, 'urlPattern'),
								sortBy: optionalString(args, 'sortBy') as
									| 'url'
									| 'validator'
									| 'severity'
									| 'rule'
									| 'message'
									| 'code'
									| undefined,
								sortOrder: optionalString(args, 'sortOrder') as
									| 'asc'
									| 'desc'
									| undefined,
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
							}),
						);
					}
					case 'list_console_logs': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await listConsoleLogs(accessor, {
								type: optionalString(args, 'type'),
								sortBy: optionalString(args, 'sortBy') as
									| 'totalCount'
									| 'pageCount'
									| 'text'
									| 'type'
									| undefined,
								sortOrder: optionalString(args, 'sortOrder') as
									| 'asc'
									| 'desc'
									| undefined,
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
							}),
						);
					}
					case 'get_page_console_logs': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await getPageConsoleLogs(accessor, requireString(args, 'url')),
						);
					}
					case 'find_duplicates': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const field = args.field
							? validateEnum(String(args.field), VALID_DUPLICATE_FIELDS, 'field')
							: undefined;
						return jsonResult(
							await getDuplicatesFastPath(accessor, {
								field,
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
								pagesLimit: optionalNumber(args, 'pagesLimit'),
								cursor: optionalString(args, 'cursor'),
							}),
						);
					}
					case 'find_duplicate_bodies': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await findDuplicateBodies(
								accessor,
								optionalNumber(args, 'limit'),
								optionalNumber(args, 'offset'),
							),
						);
					}
					case 'find_duplicate_clusters': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await listDuplicateBodyClusters(accessor, {
								minCount: optionalNumber(args, 'minCount'),
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
								samplePagesLimit: optionalNumber(args, 'samplePagesLimit'),
							}),
						);
					}
					case 'find_mismatches': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const type = validateEnum(
							requireString(args, 'type'),
							VALID_MISMATCH_TYPES,
							'mismatch type',
						);
						return jsonResult(
							await getMismatchesFastPath(accessor, type, {
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
								urlPattern: optionalString(args, 'urlPattern'),
								sortBy: optionalString(args, 'sortBy') as
									| 'url'
									| 'actual'
									| 'expected'
									| undefined,
								sortOrder: optionalString(args, 'sortOrder') as
									| 'asc'
									| 'desc'
									| undefined,
								cursor: optionalString(args, 'cursor'),
							}),
						);
					}
					case 'get_resource_referrers': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const resourceUrl = requireString(args, 'resourceUrl');
						const result = await getResourceReferrers(accessor, {
							resourceUrl,
							limit: optionalNumber(args, 'limit'),
							cursor: optionalString(args, 'cursor'),
						});
						if (!result) {
							return textResult('Resource not found.');
						}
						return jsonResult(result);
					}
					case 'check_headers': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await getHeaderChecksFastPath(accessor, omit(args, 'archiveId')),
						);
					}
					case 'list_isolated_pages': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await listIsolatedPagesFastPath(accessor, {
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
							}),
						);
					}
					case 'list_isolated_clusters': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await listIsolatedClustersFastPath(accessor, {
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
							}),
						);
					}
					case 'get_isolated_cluster': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const result = await getIsolatedClusterFastPath(
							accessor,
							requireString(args, 'representativeUrl'),
						);
						if (result === null) {
							return textResult('Isolated cluster not found.');
						}
						return jsonResult(result);
					}
					case 'list_unused_resources': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await listUnusedResources(accessor, {
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
							}),
						);
					}
					case 'list_network_outages': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await listNetworkOutages(accessor, {
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
							}),
						);
					}
					case 'list_dedupe_cap_events': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await listDedupeCapEvents(accessor, {
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
							}),
						);
					}
					case 'list_pages_by_technology': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await listPagesByTechnology(accessor, {
								technology: requireString(args, 'technology'),
								minConfidence: optionalNumber(args, 'minConfidence'),
								signalType:
									typeof args.signalType === 'string'
										? (args.signalType as TechnologySignalEntry['signalType'])
										: undefined,
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
							}),
						);
					}
					case 'count_pages_by_technology': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await countPagesByTechnology(accessor, {
								technology: requireString(args, 'technology'),
								minConfidence: optionalNumber(args, 'minConfidence'),
								signalType:
									typeof args.signalType === 'string'
										? (args.signalType as TechnologySignalEntry['signalType'])
										: undefined,
							}),
						);
					}
					case 'list_pages_by_jsonld_type': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await listPagesByJsonLdType(accessor, {
								type: requireString(args, 'type'),
								limit: optionalNumber(args, 'limit'),
								offset: optionalNumber(args, 'offset'),
							}),
						);
					}
					case 'count_pages_by_jsonld_type': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await countPagesByJsonLdType(accessor, {
								type: requireString(args, 'type'),
							}),
						);
					}
					case 'get_technology_inventory': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await getTechnologyInventoryFastPath(accessor));
					}
					case 'get_page_jsonld': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const slim = typeof args.slim === 'boolean' ? args.slim : true;
						return jsonResult(
							await getPageJsonLd(accessor, requireString(args, 'url'), slim),
						);
					}
					case 'get_page_jsonld_overview': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await getPageJsonLdOverview(accessor, requireString(args, 'url')),
						);
					}
					case 'get_page_technologies': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await getPageTechnologies(accessor, requireString(args, 'url')),
						);
					}
					case 'get_page_main_contents': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await getPageMainContents(accessor, requireString(args, 'url')),
						);
					}
					default: {
						return {
							content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
							isError: true,
						};
					}
				}
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	return server;
}

/**
 * Starts the MCP server using stdio transport.
 * This is the entry point for the `nitpicker-mcp` binary.
 * @returns Resolves once the stdio transport is connected; the server then
 *   keeps serving requests until the process exits.
 * @example
 * ```ts
 * import { startServer } from '@nitpicker/mcp-server';
 *
 * await startServer();
 * ```
 */
export async function startServer() {
	const server = createServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

/**
 * Formats a successful result as JSON text content.
 * @param data - The data to serialize.
 * @returns MCP tool result with JSON text content.
 */
function jsonResult(data: unknown) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
	};
}

/**
 * Formats a plain text result.
 * @param text - The text content.
 * @returns MCP tool result with text content.
 */
function textResult(text: string) {
	return {
		content: [{ type: 'text' as const, text }],
	};
}

/**
 * Sanitizes an error message by removing absolute file paths
 * to avoid leaking internal directory structures.
 * @param message - The raw error message.
 * @returns The sanitized message.
 */
function sanitizeErrorMessage(message: string): string {
	return message.replaceAll(/(?:\/[^\s'",)]+){2,}/g, '<path>');
}

/**
 * Formats an error as an MCP tool error result.
 * Error messages are sanitized to avoid leaking internal paths.
 * @param error - The error to format.
 * @returns MCP tool error result with the sanitized error message.
 */
function errorResult(error: unknown) {
	const rawMessage = error instanceof Error ? error.message : String(error);
	const message = sanitizeErrorMessage(rawMessage);
	return {
		content: [{ type: 'text' as const, text: `Error: ${message}` }],
		isError: true,
	};
}
