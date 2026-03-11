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
						const { archiveId, archive } = await manager.open(args.filePath as string);
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
						await manager.close(args.archiveId as string);
						return textResult('Archive closed successfully.');
					}
					case 'get_summary': {
						const accessor = manager.get(args.archiveId as string);
						return jsonResult(await getSummary(accessor));
					}
					case 'list_pages': {
						const { archiveId: aid, ...options } = args;
						const accessor = manager.get(aid as string);
						return jsonResult(await listPages(accessor, options));
					}
					case 'get_page_detail': {
						const accessor = manager.get(args.archiveId as string);
						const result = await getPageDetail(accessor, args.url as string);
						if (!result) {
							return textResult('Page not found.');
						}
						return jsonResult(result);
					}
					case 'get_page_html': {
						const accessor = manager.get(args.archiveId as string);
						const result = await getPageHtml(
							accessor,
							args.url as string,
							(args.maxLength as number | undefined) ?? undefined,
						);
						if (!result) {
							return textResult('HTML snapshot not found.');
						}
						const text = result.truncated
							? `[Truncated to ${(args.maxLength as number) ?? 100_000} chars]\n${result.html}`
							: result.html;
						return textResult(text);
					}
					case 'list_links': {
						const { archiveId: aid2, ...linkOpts } = args;
						const accessor = manager.get(aid2 as string);
						return jsonResult(
							await listLinks(
								accessor,
								linkOpts as { type: 'broken' | 'external' | 'orphaned' },
							),
						);
					}
					case 'list_resources': {
						const { archiveId: aid3, ...resOpts } = args;
						const accessor = manager.get(aid3 as string);
						return jsonResult(await listResources(accessor, resOpts));
					}
					case 'list_images': {
						const { archiveId: aid4, ...imgOpts } = args;
						const accessor = manager.get(aid4 as string);
						return jsonResult(await listImages(accessor, imgOpts));
					}
					case 'get_violations': {
						const { archiveId: aid5, ...violOpts } = args;
						const accessor = manager.get(aid5 as string);
						return jsonResult(await getViolations(accessor, violOpts));
					}
					case 'find_duplicates': {
						const accessor = manager.get(args.archiveId as string);
						return jsonResult(
							await findDuplicates(
								accessor,
								(args.field as 'title' | 'description' | undefined) ?? undefined,
								(args.limit as number | undefined) ?? undefined,
							),
						);
					}
					case 'find_mismatches': {
						const accessor = manager.get(args.archiveId as string);
						return jsonResult(
							await findMismatches(
								accessor,
								args.type as 'canonical' | 'og:title' | 'og:description',
								(args.limit as number | undefined) ?? undefined,
								(args.offset as number | undefined) ?? undefined,
							),
						);
					}
					case 'get_resource_referrers': {
						const accessor = manager.get(args.archiveId as string);
						const result = await getResourceReferrers(
							accessor,
							args.resourceUrl as string,
						);
						if (!result) {
							return textResult('Resource not found.');
						}
						return jsonResult(result);
					}
					case 'check_headers': {
						const { archiveId: aid6, ...headerOpts } = args;
						const accessor = manager.get(aid6 as string);
						return jsonResult(await checkHeaders(accessor, headerOpts));
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
