import { describe, expect, it } from 'vitest';

import { parsePageDirectoryPrefix } from './parse-page-directory-prefix.js';

describe('parsePageDirectoryPrefix', () => {
	it('splits a full URL into its host and pathname', () => {
		expect(parsePageDirectoryPrefix('https://example.com/blog/')).toEqual({
			hostname: 'example.com',
			pathname: '/blog',
		});
	});

	it('treats a full URL with and without a trailing slash as the same prefix', () => {
		expect(parsePageDirectoryPrefix('https://example.com/blog')).toEqual(
			parsePageDirectoryPrefix('https://example.com/blog/'),
		);
	});

	it('keeps every path segment of a deep URL', () => {
		expect(parsePageDirectoryPrefix('https://example.com/blog/2024/spring/')).toEqual({
			hostname: 'example.com',
			pathname: '/blog/2024/spring',
		});
	});

	it('reads a host-only URL as that host with no path restriction', () => {
		expect(parsePageDirectoryPrefix('https://example.com')).toEqual({
			hostname: 'example.com',
			pathname: '',
		});
		expect(parsePageDirectoryPrefix('https://example.com/')).toEqual({
			hostname: 'example.com',
			pathname: '',
		});
	});

	it('lowercases the host and drops the port, matching viewer_pages.hostname', () => {
		expect(parsePageDirectoryPrefix('https://Example.COM:8080/blog')).toEqual({
			hostname: 'example.com',
			pathname: '/blog',
		});
	});

	it('ignores the scheme when comparing hosts', () => {
		expect(parsePageDirectoryPrefix('http://example.com/blog')).toEqual(
			parsePageDirectoryPrefix('https://example.com/blog'),
		);
	});

	it('reads a pathname-only filter as host-agnostic', () => {
		expect(parsePageDirectoryPrefix('/blog')).toEqual({
			hostname: null,
			pathname: '/blog',
		});
	});

	it('accepts a pathname-only filter without a leading slash', () => {
		expect(parsePageDirectoryPrefix('blog/2024')).toEqual({
			hostname: null,
			pathname: '/blog/2024',
		});
	});

	it('reads the site root as no restriction at all', () => {
		expect(parsePageDirectoryPrefix('/')).toEqual({ hostname: null, pathname: '' });
	});

	it('collapses repeated slashes the way parse-url does', () => {
		expect(parsePageDirectoryPrefix('//blog//2024//')).toEqual({
			hostname: null,
			pathname: '/blog/2024',
		});
	});

	it('drops a query string and hash from either spelling', () => {
		expect(parsePageDirectoryPrefix('/blog?page=2#top')).toEqual({
			hostname: null,
			pathname: '/blog',
		});
		expect(parsePageDirectoryPrefix('https://example.com/blog?page=2#top')).toEqual({
			hostname: 'example.com',
			pathname: '/blog',
		});
	});

	it('keeps a percent-encoded segment verbatim, matching path_sort_key', () => {
		const encoded = '/blog%20archive';
		expect(parsePageDirectoryPrefix(`https://example.com${encoded}/`)).toEqual({
			hostname: 'example.com',
			pathname: encoded,
		});
	});

	it('throws on a blank filter instead of silently matching every page', () => {
		expect(() => parsePageDirectoryPrefix('')).toThrow(TypeError);
		expect(() => parsePageDirectoryPrefix('   ')).toThrow(TypeError);
	});

	it('throws on a URL-shaped filter with no host to match', () => {
		expect(() => parsePageDirectoryPrefix('https://[')).toThrow(TypeError);
		expect(() => parsePageDirectoryPrefix('file:///blog/')).toThrow(TypeError);
	});
});
