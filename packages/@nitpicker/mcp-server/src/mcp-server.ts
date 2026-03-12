import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
	ArchiveManager,
	checkHeaders,
	findDuplicates,
	findMismatches,
	getPageDetail,
	getPageHtml,
	getResourceReferrers,
	getSummary,
	getViolations,
	listImages,
	listLinks,
	listPages,
	listResources,
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
 * Extracts an optional number argument.
 * @param args - The arguments object.
 * @param key - The argument key.
 * @returns The number value, or undefined if not present.
 */
function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	if (value == null) {
		return undefined;
	}
	return Number(value);
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
 * Creates and configures the Nitpicker MCP server with all 14 tools registered.
 * Uses the low-level Server API to avoid deep type instantiation issues
 * with McpServer + Zod schemas.
 * @returns The configured Server instance.
 */
export function createServer() {
	const manager = new ArchiveManager();
	const server = new Server(
		{ name: 'nitpicker', version: '0.4.4' },
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
						const { archiveId, archive } = await manager.open(filePath);
						const config = await archive.getConfig();
						const knex = manager.get(archiveId).getKnex();
						const countResult = await knex('pages').count('id as total');
						const total = Number(
							(countResult[0] as Record<string, unknown>)?.['total'] ?? 0,
						);
						return jsonResult({
							archiveId,
							baseUrl: config.baseUrl,
							totalPages: total,
						});
					}
					case 'close_archive': {
						const archiveId = requireString(args, 'archiveId');
						await manager.close(archiveId);
						return textResult('Archive closed successfully.');
					}
					case 'get_summary': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await getSummary(accessor));
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
						const type = requireString(args, 'type');
						const linkOpts = omit(args, 'archiveId');
						return jsonResult(
							await listLinks(accessor, {
								...linkOpts,
								type: type as 'broken' | 'external' | 'orphaned',
							}),
						);
					}
					case 'list_resources': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await listResources(accessor, omit(args, 'archiveId')));
					}
					case 'list_images': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await listImages(accessor, omit(args, 'archiveId')));
					}
					case 'get_violations': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await getViolations(accessor, omit(args, 'archiveId')));
					}
					case 'find_duplicates': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(
							await findDuplicates(
								accessor,
								(args.field as 'title' | 'description' | undefined) ?? undefined,
								optionalNumber(args, 'limit'),
							),
						);
					}
					case 'find_mismatches': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const type = requireString(args, 'type');
						return jsonResult(
							await findMismatches(
								accessor,
								type as 'canonical' | 'og:title' | 'og:description',
								optionalNumber(args, 'limit'),
								optionalNumber(args, 'offset'),
							),
						);
					}
					case 'get_resource_referrers': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						const resourceUrl = requireString(args, 'resourceUrl');
						const result = await getResourceReferrers(accessor, resourceUrl);
						if (!result) {
							return textResult('Resource not found.');
						}
						return jsonResult(result);
					}
					case 'check_headers': {
						const accessor = manager.get(requireString(args, 'archiveId'));
						return jsonResult(await checkHeaders(accessor, omit(args, 'archiveId')));
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
 * Formats an error as an MCP tool error result.
 * @param error - The error to format.
 * @returns MCP tool error result with the error message.
 */
function errorResult(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{ type: 'text' as const, text: `Error: ${message}` }],
		isError: true,
	};
}
