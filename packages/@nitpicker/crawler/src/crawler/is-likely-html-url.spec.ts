import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { isLikelyHtmlUrl } from './is-likely-html-url.js';

describe('isLikelyHtmlUrl', () => {
	it.each([
		'https://example.com/',
		'https://example.com/about/',
		'https://example.com/blog',
		'http://example.com/path/to/page',
	])('returns true for extensionless / directory-style URL %s', (raw) => {
		expect(isLikelyHtmlUrl(parseUrl(raw)!)).toBe(true);
	});

	it('returns true for a bare trailing-dot URL (extname === ".")', () => {
		const url = parseUrl('https://example.com/index.')!;
		// Guard the assumption the branch depends on: parse-url surfaces "." here.
		expect(url.extname).toBe('.');
		expect(isLikelyHtmlUrl(url)).toBe(true);
	});

	it.each([
		'https://example.com/index.html',
		'https://example.com/index.htm',
		'https://example.com/page.xhtml',
		'https://example.com/page.shtml',
		'https://example.com/page.mhtml',
		'https://example.com/page.php',
		'https://example.com/legacy.php5',
		'https://example.com/page.asp',
		'https://example.com/page.aspx',
		'https://example.com/handler.ashx',
		'https://example.com/page.jsp',
		'https://example.com/page.jsf',
		'https://example.com/page.cfm',
		'https://example.com/handler.do',
	])('returns true for known HTML extension %s', (raw) => {
		expect(isLikelyHtmlUrl(parseUrl(raw)!)).toBe(true);
	});

	it.each([
		['https://example.com/PAGE.HTML', true],
		['https://example.com/LEGACY.PHP5', true],
		['https://example.com/PHOTO.JPG', false],
	])('classifies %s case-insensitively', (raw, expected) => {
		expect(isLikelyHtmlUrl(parseUrl(raw)!)).toBe(expected);
	});

	it.each([
		'https://example.com/page.php?id=1',
		'https://example.com/search?q=foo',
		'https://example.com/index.html?ref=nav',
	])('classifies query-string HTML URL %s by its path extension', (raw) => {
		expect(isLikelyHtmlUrl(parseUrl(raw)!)).toBe(true);
	});

	it('classifies a query-string non-HTML URL by its path extension', () => {
		expect(isLikelyHtmlUrl(parseUrl('https://example.com/data.json?v=2')!)).toBe(false);
	});

	it.each([
		'https://example.com/photo.jpg',
		'https://example.com/doc.pdf',
		'https://example.com/style.css',
		'https://example.com/app.js',
		'https://example.com/data.json',
		'https://example.com/archive.zip',
		'https://example.com/feed.xml',
	])('returns false for non-HTML asset/document URL %s', (raw) => {
		expect(isLikelyHtmlUrl(parseUrl(raw)!)).toBe(false);
	});

	it('treats a compound extension by its last segment (.tar.gz → non-HTML)', () => {
		const url = parseUrl('https://example.com/archive.tar.gz')!;
		expect(url.extname).toBe('.gz');
		expect(isLikelyHtmlUrl(url)).toBe(false);
	});

	it('treats a dotfile with no real extension as HTML (extname === null)', () => {
		const url = parseUrl('https://example.com/.htaccess')!;
		expect(url.extname).toBeNull();
		expect(isLikelyHtmlUrl(url)).toBe(true);
	});

	it.each(['mailto:hello@example.com', 'tel:+81312345678'])(
		'returns false for non-HTTP URL %s',
		(raw) => {
			expect(isLikelyHtmlUrl(parseUrl(raw)!)).toBe(false);
		},
	);

	it('returns false for a non-HTTP URL even when it carries an HTML-looking extension', () => {
		expect(isLikelyHtmlUrl(parseUrl('ftp://example.com/page.html')!)).toBe(false);
	});
});
