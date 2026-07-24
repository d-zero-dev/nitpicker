import { describe, it, expect } from 'vitest';

import { normalizeUrlLikeStrings } from './normalize-url-like-strings.js';

describe('normalizeUrlLikeStrings', () => {
	it('collapses /index.html to a trailing slash', () => {
		expect(normalizeUrlLikeStrings('<a href="/about/index.html">about</a>')).toBe(
			'<a href="/about/">about</a>',
		);
	});

	it('collapses the root /index.html to /', () => {
		expect(normalizeUrlLikeStrings('<a href="/index.html">home</a>')).toBe(
			'<a href="/">home</a>',
		);
	});

	it.each(['index.htm', 'index.php', 'index.jsp', 'index.asp'])(
		'collapses /%s the same way as /index.html',
		(file) => {
			expect(normalizeUrlLikeStrings(`/section/${file}`)).toBe('/section/');
		},
	);

	it('matches case-insensitively', () => {
		expect(normalizeUrlLikeStrings('/about/Index.HTML')).toBe('/about/');
	});

	it('applies outside of attribute values (plain text URLs)', () => {
		expect(normalizeUrlLikeStrings('see /about/index.html for details')).toBe(
			'see /about/ for details',
		);
	});

	it('applies inside inline script text', () => {
		expect(normalizeUrlLikeStrings('<script>var u = "/about/index.html";</script>')).toBe(
			'<script>var u = "/about/";</script>',
		);
	});

	it('leaves strings without an /index.{ext} suffix unchanged', () => {
		const body = '<a href="/about/">about</a><p>index.html mentioned as plain text</p>';
		expect(normalizeUrlLikeStrings(body)).toBe(body);
	});

	it('is idempotent', () => {
		const once = normalizeUrlLikeStrings('/about/index.html');
		const twice = normalizeUrlLikeStrings(once);
		expect(twice).toBe(once);
	});

	it('normalizes multiple occurrences independently', () => {
		const body = '<a href="/a/index.html">a</a><a href="/b/index.php">b</a>';
		expect(normalizeUrlLikeStrings(body)).toBe('<a href="/a/">a</a><a href="/b/">b</a>');
	});
});
