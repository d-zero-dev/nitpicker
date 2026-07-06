import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer } from './mcp-server.js';
import { toolDefinitions } from './tool-definitions.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_mcp_server__');

/**
 * Sends a CallToolRequest to the MCP server and returns the result.
 * Uses the low-level Server API's request handler directly.
 *
 * NOTE: This function accesses the internal `_requestHandlers` map of the
 * MCP SDK's `Server` class. This is an implementation detail of the SDK
 * and may change across SDK versions. If tests break after an SDK upgrade,
 * check whether `_requestHandlers` still exists and has the same shape.
 * @param server - The MCP server instance.
 * @param toolName - The name of the tool to call.
 * @param args - The tool arguments.
 * @returns The tool result.
 */
async function callTool(
	server: ReturnType<typeof createServer>,
	toolName: string,
	args: Record<string, unknown> = {},
) {
	// Access the internal request handler via a protocol-level request
	type RequestHandler = (request: unknown) => Promise<unknown>;
	const handler = (server as unknown as { _requestHandlers: Map<string, RequestHandler> })
		._requestHandlers;
	const callToolHandler = handler.get('tools/call');
	if (!callToolHandler) {
		throw new Error('CallTool handler not registered');
	}
	return callToolHandler({
		method: 'tools/call',
		params: { name: toolName, arguments: args },
	}) as Promise<{
		content: { type: string; text: string }[];
		isError?: boolean;
	}>;
}

/**
 * Sends a ListToolsRequest to the MCP server.
 *
 * NOTE: This function accesses the internal `_requestHandlers` map of the
 * MCP SDK's `Server` class. This is an implementation detail of the SDK
 * and may change across SDK versions. If tests break after an SDK upgrade,
 * check whether `_requestHandlers` still exists and has the same shape.
 * @param server - The MCP server instance.
 * @returns The list of tools.
 */
async function listTools(server: ReturnType<typeof createServer>) {
	type RequestHandler = (request: unknown) => Promise<unknown>;
	const handler = (server as unknown as { _requestHandlers: Map<string, RequestHandler> })
		._requestHandlers;
	const listToolsHandler = handler.get('tools/list');
	if (!listToolsHandler) {
		throw new Error('ListTools handler not registered');
	}
	return listToolsHandler({
		method: 'tools/list',
		params: {},
	}) as Promise<{ tools: { name: string; description: string }[] }>;
}

describe('createServer', () => {
	let archive: InstanceType<typeof Archive>;
	let server: ReturnType<typeof createServer>;
	let archiveId: string;
	const archiveFilePath = path.resolve(workingDir, 'mcp-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.10.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 500,
			responseHeaders: {
				'Content-Security-Policy': "default-src 'self'",
				'X-Frame-Options': 'DENY',
			},
			html: '<html><head><title>Home</title></head><body><h1>Home</h1></body></html>',
			meta: {
				lang: 'ja',
				title: 'Home',
				description: 'Home page',
				keywords: 'test',
				noindex: false,
				nofollow: false,
				noarchive: false,
				canonical: 'https://example.com',
				alternate: null,
				'og:type': 'website',
				'og:title': 'Home',
				'og:site_name': 'Example',
				'og:description': 'Home page',
				'og:url': 'https://example.com',
				'og:image': 'https://example.com/og.png',
				'twitter:card': 'summary',
			},
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About us',
				},
			],
			imageList: [
				{
					src: 'https://example.com/logo.png',
					currentSrc: 'https://example.com/logo.png',
					alt: 'Logo',
					width: 200,
					height: 100,
					naturalWidth: 400,
					naturalHeight: 200,
					isLazy: false,
					viewportWidth: 1280,
					sourceCode: '<img src="logo.png" alt="Logo">',
				},
			],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 300,
			responseHeaders: {},
			html: '<html><head><title>About</title></head><body><h1>About</h1></body></html>',
			meta: {
				lang: 'ja',
				title: 'About',
				description: null,
				keywords: null,
				noindex: false,
				nofollow: false,
				noarchive: false,
				canonical: null,
				alternate: null,
				'og:type': null,
				'og:title': null,
				'og:site_name': null,
				'og:description': null,
				'og:url': null,
				'og:image': null,
				'twitter:card': null,
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setResources({
			url: parseUrl('https://example.com/style.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 1000,
			compress: 'gzip',
			cdn: false,
			headers: null,
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com',
			src: 'https://example.com/style.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/about',
			src: 'https://example.com/style.css',
		});

		await archive.write();
		await archive.close();

		server = createServer();
	});

	afterAll(async () => {
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('ListTools で26個のツールが返される (v3: + list_isolated_clusters + get_isolated_cluster)', async () => {
		const result = await listTools(server);
		expect(result.tools).toHaveLength(26);
		const names = result.tools.map((t) => t.name);
		expect(names).toContain('open_archive');
		expect(names).toContain('close_archive');
		expect(names).toContain('get_summary');
		expect(names).toContain('list_isolated_clusters');
		expect(names).toContain('get_isolated_cluster');
		// New in v2:
		expect(names).toContain('list_pages_by_tag');
		expect(names).toContain('list_pages_by_jsonld_type');
		expect(names).toContain('get_tag_inventory');
		expect(names).toContain('get_page_jsonld');
		expect(names).toContain('get_page_tags');
		expect(names).toContain('count_pages_by_tag');
		expect(names).toContain('count_pages_by_jsonld_type');
		expect(names).toContain('get_page_jsonld_overview');
		// New in inventory feature:
		expect(names).toContain('list_isolated_pages');
		expect(names).toContain('list_unused_resources');
	});

	it('toolDefinitions の数と ListTools の数が一致する', async () => {
		const result = await listTools(server);
		expect(toolDefinitions.length).toBe(result.tools.length);
	});

	it('open_archive でアーカイブを開ける（mode=archive, crawlerPid=null も返す）', async () => {
		const result = await callTool(server, 'open_archive', {
			filePath: archiveFilePath,
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(data.archiveId).toBeDefined();
		expect(data.baseUrl).toBe('https://example.com');
		expect(data.roots).toEqual(['https://example.com']);
		expect(data.totalPages).toBe(2);
		// New fields contracted with LLM callers: source kind and crawler liveness.
		expect(data.mode).toBe('archive');
		expect(data.crawlerPid).toBeNull();
		archiveId = data.archiveId;
	});

	it('get_summary でサイト概要を取得する', async () => {
		const result = await callTool(server, 'get_summary', { archiveId });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(data.totalPages).toBe(2);
		expect(data.baseUrl).toBe('https://example.com');
		expect(data.roots).toEqual(['https://example.com']);
	});

	it('list_pages で全ページをリストする', async () => {
		const result = await callTool(server, 'list_pages', { archiveId });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(data.items.length).toBe(2);
	});

	it('list_pages は hasCSP でフィルタする', async () => {
		const result = await callTool(server, 'list_pages', { archiveId, hasCSP: true });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(data.items).toHaveLength(1);
		expect(data.items[0].url).toBe('https://example.com');
		expect(data.items[0].hasCSP).toBe(true);
	});

	it('get_page_detail でページ詳細を取得する', async () => {
		const result = await callTool(server, 'get_page_detail', {
			archiveId,
			url: 'https://example.com',
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(data.url).toBe('https://example.com');
		expect(data.title).toBe('Home');
		expect(data.outboundLinks).toBeDefined();
		expect(data.outboundLinks.length).toBe(1);
		expect(data.inboundLinks).toBeDefined();
		expect(data.inboundLinks.length).toBe(0);
	});

	it('get_page_detail で存在しないページは "Page not found." を返す', async () => {
		const result = await callTool(server, 'get_page_detail', {
			archiveId,
			url: 'https://example.com/nonexistent',
		});
		expect(result.content[0]!.text).toBe('Page not found.');
	});

	it('get_page_html で HTML スナップショットを取得する', async () => {
		const result = await callTool(server, 'get_page_html', {
			archiveId,
			url: 'https://example.com',
		});
		expect(result.isError).toBeUndefined();
		expect(result.content[0]!.text).toContain('<title>Home</title>');
	});

	it('list_links で broken リンクを取得する', async () => {
		const result = await callTool(server, 'list_links', {
			archiveId,
			type: 'broken',
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(Array.isArray(data.items)).toBe(true);
	});

	it('list_resources でリソースをリストする', async () => {
		const result = await callTool(server, 'list_resources', { archiveId });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(Array.isArray(data.items)).toBe(true);
		expect(data.items.length).toBe(1);
	});

	it('get_resource_referrers でリソースの参照元ページを返す', async () => {
		const result = await callTool(server, 'get_resource_referrers', {
			archiveId,
			resourceUrl: 'https://example.com/style.css',
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(data.total).toBe(2);
		expect(data.pageUrls).toHaveLength(2);
		expect(data.nextCursor).toBeNull();
	});

	it('get_resource_referrers は limit/cursor で bound/継続できる', async () => {
		const first = await callTool(server, 'get_resource_referrers', {
			archiveId,
			resourceUrl: 'https://example.com/style.css',
			limit: 1,
		});
		const firstData = JSON.parse(first.content[0]!.text);
		expect(firstData.pageUrls).toHaveLength(1);
		expect(firstData.total).toBe(2);
		expect(firstData.nextCursor).not.toBeNull();

		const second = await callTool(server, 'get_resource_referrers', {
			archiveId,
			resourceUrl: 'https://example.com/style.css',
			limit: 1,
			cursor: firstData.nextCursor,
		});
		const secondData = JSON.parse(second.content[0]!.text);
		expect(secondData.pageUrls).toHaveLength(1);
		expect(secondData.nextCursor).toBeNull();
	});

	it('list_images で画像をリストする', async () => {
		const result = await callTool(server, 'list_images', { archiveId });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(Array.isArray(data.items)).toBe(true);
		expect(data.items.length).toBe(1);
	});

	it('find_duplicates で重複タイトルを検出する（getDuplicatesFastPath 経由、issue #115）', async () => {
		const result = await callTool(server, 'find_duplicates', { archiveId });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		// getDuplicatesFastPath always normalizes to a CursorPaginatedDuplicateGroupList,
		// not the bare array the legacy findDuplicates returned.
		expect(Array.isArray(data.items)).toBe(true);
		expect(data.total).toBe(0);
	});

	it('find_mismatches で canonical ミスマッチを検出する（getMismatchesFastPath 経由、issue #115）', async () => {
		const result = await callTool(server, 'find_mismatches', {
			archiveId,
			type: 'canonical',
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		// getMismatchesFastPath always normalizes to a CursorPaginatedMismatchList,
		// not the bare array the legacy findMismatches's positional-args overload returned.
		expect(Array.isArray(data.items)).toBe(true);
		expect(data.total).toBe(0);
	});

	it('check_headers でセキュリティヘッダーを確認する', async () => {
		const result = await callTool(server, 'check_headers', { archiveId });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(data.items).toBeDefined();
	});

	it('存在しない archiveId でエラーを返す', async () => {
		const result = await callTool(server, 'get_summary', {
			archiveId: 'nonexistent',
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toContain('Error:');
	});

	it('不明なツール名でエラーを返す', async () => {
		const result = await callTool(server, 'unknown_tool', {});
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toContain('Unknown tool');
	});

	it('必須引数が欠けているとエラーを返す', async () => {
		const result = await callTool(server, 'open_archive', {});
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toContain('Missing required argument');
	});

	it('不正な link type でエラーを返す', async () => {
		const result = await callTool(server, 'list_links', {
			archiveId,
			type: 'invalid',
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toContain('Invalid link type');
	});

	it('不正な mismatch type でエラーを返す', async () => {
		const result = await callTool(server, 'find_mismatches', {
			archiveId,
			type: 'invalid',
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toContain('Invalid mismatch type');
	});

	it('不正な数値引数でエラーを返す', async () => {
		const result = await callTool(server, 'get_page_html', {
			archiveId,
			url: 'https://example.com',
			maxLength: 'abc',
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toContain('Invalid number');
	});

	it('find_duplicates の不正な limit 引数でエラーを返す（issue #115 の validation 回帰）', async () => {
		const result = await callTool(server, 'find_duplicates', {
			archiveId,
			limit: 'abc',
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toContain('Invalid number');
	});

	it('find_mismatches の不正な offset 引数でエラーを返す（issue #115 の validation 回帰）', async () => {
		const result = await callTool(server, 'find_mismatches', {
			archiveId,
			type: 'canonical',
			offset: 'abc',
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toContain('Invalid number');
	});

	it('close_archive でアーカイブを閉じる', async () => {
		const result = await callTool(server, 'close_archive', { archiveId });
		expect(result.isError).toBeUndefined();
		expect(result.content[0]!.text).toBe('Archive closed successfully.');
	});

	it('閉じた後にクエリするとエラーになる', async () => {
		const result = await callTool(server, 'get_summary', { archiveId });
		expect(result.isError).toBe(true);
	});
});

describe('createServer stub-mode support', () => {
	const stubServerWorkingDir = path.resolve(workingDir, '__mcp_stub_fixture__');
	const stubFilePath = path.resolve(stubServerWorkingDir, 'mcp-stub.nitpicker');
	let stubTmpDir = '';
	let server: ReturnType<typeof createServer>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(stubServerWorkingDir, { recursive: true });
		const archive = await Archive.create({
			filePath: stubFilePath,
			cwd: stubServerWorkingDir,
		});
		stubTmpDir = archive.tmpDir;
		await archive.setConfig({
			baseUrl: 'https://stub.example.com',
			roots: ['https://stub.example.com'],
			name: 'mcp-stub',
			version: '0.10.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'mcp-stub',
			ignoreRobots: false,
		});
		// Release handle without finalizing so the tmpDir remains as a
		// stub fixture an LLM caller might point `open_archive` at.
		await archive.releaseHandle();
		server = createServer();
	});

	afterAll(async () => {
		const { rmSync } = await import('node:fs');
		rmSync(stubServerWorkingDir, { recursive: true, force: true });
	});

	it('open_archive にディレクトリパスを渡すと mode=stub と crawlerPid=null を返す（LLM 向け契約）', async () => {
		const result = await callTool(server, 'open_archive', {
			filePath: stubTmpDir,
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0]!.text);
		expect(data.archiveId).toBeDefined();
		expect(data.baseUrl).toBe('https://stub.example.com');
		expect(data.mode).toBe('stub');
		// No live crawler attached to the fixture stub → null PID, so the
		// LLM caller can correctly distinguish "live crawl in progress"
		// (data is moving) from "interrupted crawl stub" (read-only fixture).
		expect(data.crawlerPid).toBeNull();
		await callTool(server, 'close_archive', { archiveId: data.archiveId });
	});
});
