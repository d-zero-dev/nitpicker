import { describe, expect, it } from 'vitest';

import { parseDirectoryInput } from './parse-directory-input.js';

describe('parseDirectoryInput', () => {
	it('normalizes and deduplicates pathname and full URL prefixes', () => {
		expect(
			parseDirectoryInput(
				'/docs/, https://example.com/help/, /docs,https://example.com/help',
			),
		).toEqual([
			{ origin: null, pathname: '/docs', display: '/docs' },
			{
				origin: 'https://example.com',
				pathname: '/help',
				display: 'https://example.com/help',
			},
		]);
	});

	it('accepts the root pathname', () => {
		expect(parseDirectoryInput('/')).toEqual([
			{ origin: null, pathname: '/', display: '/' },
		]);
	});

	it('ignores query strings and hashes', () => {
		expect(parseDirectoryInput('/docs?q=1#top')).toEqual([
			{ origin: null, pathname: '/docs', display: '/docs' },
		]);
	});

	it('rejects relative paths', () => {
		expect(() => parseDirectoryInput('docs')).toThrow(/full URL/);
	});

	it('treats a leading double slash as a pathname, not a protocol-relative URL', () => {
		expect(parseDirectoryInput('//blog')).toEqual([
			{ origin: null, pathname: '/blog', display: '/blog' },
		]);
	});

	it('drops scheme and port the way parsePageDirectoryPrefix does', () => {
		expect(parseDirectoryInput('http://Example.COM:8080/help/')).toEqual([
			{
				origin: 'https://example.com',
				pathname: '/help',
				display: 'https://example.com/help',
			},
		]);
	});

	it('deduplicates http and https spellings of the same host and path', () => {
		expect(
			parseDirectoryInput('http://example.com/help,https://example.com/help/'),
		).toEqual([
			{
				origin: 'https://example.com',
				pathname: '/help',
				display: 'https://example.com/help',
			},
		]);
	});

	it('rejects empty comma-separated entries', () => {
		expect(() => parseDirectoryInput('/docs,')).toThrow(/one or more/);
	});

	it('rejects a non-HTTP URL', () => {
		expect(() => parseDirectoryInput('file:///blog/')).toThrow(/http or https/);
	});
});
