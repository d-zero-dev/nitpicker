import type { DirectoryTreeSourceRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { buildDirectoryTreeRows } from './build-directory-tree-rows.js';

/**
 * Shorthand for a {@link DirectoryTreeSourceRow} fixture row — `isExternal`
 * defaults to `0` (internal) and `contentType` defaults to `'text/html'`
 * (so existing fixtures count toward `*_html_page_count` unless a test
 * explicitly overrides it) when omitted.
 * @param id - The row's `pages.id`.
 * @param url - The row's URL.
 * @param isExternal - Optional `isExternal` override.
 * @param contentType - Optional raw MIME override.
 * @returns The fixture row.
 */
function row(
	id: number,
	url: string,
	isExternal: number | null = 0,
	contentType: string | null = 'text/html',
): DirectoryTreeSourceRow {
	return { id, url, isExternal, contentType };
}

describe('buildDirectoryTreeRows', () => {
	it('returns no nodes and no pages for an empty input', () => {
		expect(buildDirectoryTreeRows([])).toEqual({ nodes: [], pages: [] });
	});

	it('creates exactly one depth-0 root node for a single root-only page', () => {
		const { nodes, pages } = buildDirectoryTreeRows([row(1, 'https://example.com/')]);
		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toMatchObject({
			parent_node_id: null,
			root_key: 'example.com',
			depth: 0,
			name: '',
			path: '/',
			direct_child_dir_count: 0,
			direct_page_count: 1,
			descendant_page_count: 1,
			internal_descendant_page_count: 1,
			external_descendant_page_count: 0,
			// No child DIRECTORIES (only a direct page) — has_children reflects
			// expandability via listDirectoryChildren, not "has anything at all".
			has_children: 0,
		});
		expect(pages).toEqual([
			{
				node_id: nodes[0].node_id,
				page_id: 1,
				page_url_sort_key: 'https://example.com/',
			},
		]);
	});

	it('lands a no-trailing-slash page and a trailing-slash page on the same directory node', () => {
		const { nodes, pages } = buildDirectoryTreeRows([
			row(1, 'https://example.com/blog/2024/post-1'),
			row(2, 'https://example.com/blog/2024/'),
		]);
		const leaf = nodes.find((n) => n.path === '/blog/2024/');
		expect(leaf).toMatchObject({ depth: 2, direct_page_count: 2 });
		expect(pages.filter((p) => p.node_id === leaf?.node_id)).toHaveLength(2);
	});

	it('creates intermediate directories with zero direct pages of their own', () => {
		const { nodes } = buildDirectoryTreeRows([
			row(1, 'https://example.com/a/b/c/d/page'),
		]);
		const byPath = new Map(nodes.map((n) => [n.path, n]));
		expect(byPath.get('/')).toMatchObject({
			depth: 0,
			direct_page_count: 0,
			direct_child_dir_count: 1,
		});
		expect(byPath.get('/a/')).toMatchObject({
			depth: 1,
			direct_page_count: 0,
			direct_child_dir_count: 1,
		});
		expect(byPath.get('/a/b/')).toMatchObject({
			depth: 2,
			direct_page_count: 0,
			direct_child_dir_count: 1,
		});
		expect(byPath.get('/a/b/c/')).toMatchObject({
			depth: 3,
			direct_page_count: 0,
			direct_child_dir_count: 1,
		});
		expect(byPath.get('/a/b/c/d/')).toMatchObject({
			depth: 4,
			direct_page_count: 1,
			direct_child_dir_count: 0,
		});
	});

	it('propagates descendant counts bottom-up through every ancestor', () => {
		const { nodes } = buildDirectoryTreeRows([
			row(1, 'https://example.com/blog/2024/post-1'),
			row(2, 'https://example.com/blog/2024/post-2'),
			row(3, 'https://example.com/blog/'),
		]);
		const byPath = new Map(nodes.map((n) => [n.path, n]));
		expect(byPath.get('/blog/2024/')).toMatchObject({
			direct_page_count: 2,
			descendant_page_count: 2,
		});
		expect(byPath.get('/blog/')).toMatchObject({
			direct_page_count: 1,
			descendant_page_count: 3,
		});
		expect(byPath.get('/')).toMatchObject({
			direct_page_count: 0,
			descendant_page_count: 3,
		});
	});

	it('splits descendant counts into internal/external, summing to descendant_page_count', () => {
		const { nodes } = buildDirectoryTreeRows([
			row(1, 'https://example.com/'),
			row(2, 'https://example.com/legacy/old.html', 1),
		]);
		const root = nodes.find((n) => n.path === '/')!;
		expect(root).toMatchObject({
			internal_descendant_page_count: 1,
			external_descendant_page_count: 1,
			descendant_page_count: 2,
		});
		const legacy = nodes.find((n) => n.path === '/legacy/')!;
		expect(legacy).toMatchObject({
			internal_descendant_page_count: 0,
			external_descendant_page_count: 1,
			descendant_page_count: 1,
		});
	});

	it('includes a same-host, out-of-scope (external) page in its host tree once the host qualifies', () => {
		const { nodes, pages } = buildDirectoryTreeRows([
			row(1, 'https://example.com/'),
			row(2, 'https://example.com/legacy/old.html', 1),
		]);
		expect(nodes.some((n) => n.root_key === 'example.com' && n.path === '/legacy/')).toBe(
			true,
		);
		expect(pages.some((p) => p.page_id === 2)).toBe(true);
	});

	it('excludes a host with zero internal pages entirely — no nodes, no pages', () => {
		const { nodes, pages } = buildDirectoryTreeRows([
			row(1, 'https://twitter.com/someaccount', 1),
		]);
		expect(nodes).toEqual([]);
		expect(pages).toEqual([]);
	});

	it('treats a null isExternal as internal (legacy pre-backfill rows)', () => {
		const { nodes } = buildDirectoryTreeRows([row(1, 'https://example.com/', null)]);
		expect(nodes.some((n) => n.root_key === 'example.com')).toBe(true);
		const root = nodes.find((n) => n.path === '/')!;
		expect(root.internal_descendant_page_count).toBe(1);
	});

	it('skips a row with an unparseable URL without throwing', () => {
		expect(() => buildDirectoryTreeRows([row(1, 'not a valid url')])).not.toThrow();
		const { nodes, pages } = buildDirectoryTreeRows([row(1, 'not a valid url')]);
		expect(nodes).toEqual([]);
		expect(pages).toEqual([]);
	});

	it('builds two independent, non-colliding trees for two qualifying hosts', () => {
		const { nodes } = buildDirectoryTreeRows([
			row(1, 'https://example.com/'),
			row(2, 'https://example.org/'),
		]);
		expect(nodes).toHaveLength(2);
		const nodeIds = nodes.map((n) => n.node_id);
		expect(new Set(nodeIds).size).toBe(nodeIds.length);
		expect(new Set(nodes.map((n) => n.root_key))).toEqual(
			new Set(['example.com', 'example.org']),
		);
	});

	it('merges two different subpaths of the same host into one tree as siblings (multi-root crawl)', () => {
		const { nodes } = buildDirectoryTreeRows([
			row(1, 'https://example.com/blog/index'),
			row(2, 'https://example.com/news/index'),
		]);
		const roots = nodes.filter((n) => n.parent_node_id === null);
		expect(roots).toHaveLength(1);
		const blog = nodes.find((n) => n.path === '/blog/')!;
		const news = nodes.find((n) => n.path === '/news/')!;
		expect(blog.parent_node_id).toBe(roots[0].node_id);
		expect(news.parent_node_id).toBe(roots[0].node_id);
		expect(roots[0]).toMatchObject({ direct_child_dir_count: 2 });
	});

	it('sets has_children to 0 for a leaf directory that has direct pages but no child directories', () => {
		const { nodes } = buildDirectoryTreeRows([row(1, 'https://example.com/a/b')]);
		// No trailing slash: 'b' is a page filename, so '/a/' is the leaf
		// directory here — it has 1 direct page and 0 child directories.
		const a = nodes.find((n) => n.path === '/a/')!;
		expect(a).toMatchObject({
			direct_child_dir_count: 0,
			direct_page_count: 1,
			has_children: 0,
		});
	});

	it('sets has_children to 1 for a directory that has a child directory, even with zero direct pages of its own', () => {
		const { nodes } = buildDirectoryTreeRows([row(1, 'https://example.com/a/b/c')]);
		const a = nodes.find((n) => n.path === '/a/')!;
		expect(a).toMatchObject({
			direct_child_dir_count: 1,
			direct_page_count: 0,
			has_children: 1,
		});
	});

	it('counts only html-classified rows toward direct_html_page_count, unlike direct_page_count', () => {
		const { nodes } = buildDirectoryTreeRows([
			row(1, 'https://example.com/docs/page.html', 0, 'text/html'),
			row(2, 'https://example.com/docs/photo.jpg', 0, 'image/jpeg'),
			row(3, 'https://example.com/docs/doc.pdf', 0, 'application/pdf'),
		]);
		const docs = nodes.find((n) => n.path === '/docs/')!;
		expect(docs).toMatchObject({
			direct_page_count: 3,
			direct_html_page_count: 1,
			descendant_page_count: 3,
			descendant_html_page_count: 1,
		});
	});

	it('propagates descendant_html_page_count bottom-up, excluding non-html descendants that still count toward descendant_page_count', () => {
		const { nodes } = buildDirectoryTreeRows([
			row(1, 'https://example.com/blog/2024/post.html', 0, 'text/html'),
			row(2, 'https://example.com/blog/2024/banner.jpg', 0, 'image/jpeg'),
		]);
		const byPath = new Map(nodes.map((n) => [n.path, n]));
		expect(byPath.get('/blog/2024/')).toMatchObject({
			direct_page_count: 2,
			direct_html_page_count: 1,
			descendant_page_count: 2,
			descendant_html_page_count: 1,
		});
		expect(byPath.get('/blog/')).toMatchObject({
			descendant_page_count: 2,
			descendant_html_page_count: 1,
		});
		expect(byPath.get('/')).toMatchObject({
			descendant_page_count: 2,
			descendant_html_page_count: 1,
		});
	});

	it('ignores query strings and hashes when resolving the directory chain', () => {
		const { nodes } = buildDirectoryTreeRows([
			row(1, 'https://example.com/blog/2024/post-1?utm_source=x#section'),
		]);
		expect(nodes.some((n) => n.path === '/blog/2024/')).toBe(true);
		expect(nodes.find((n) => n.path === '/blog/2024/')).toMatchObject({
			direct_page_count: 1,
		});
	});
});
