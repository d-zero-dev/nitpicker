import { describe, expect, it } from 'vitest';

import { buildCompoundRegExpSource } from './build-compound-regexp-source.js';
import { buildDirectRegExp } from './build-direct-regexp.js';
import { runDirectMatch } from './run-direct-match.js';

const IMG = buildDirectRegExp([
	buildCompoundRegExpSource({ tag: 'img', attributes: [], nth: [], negations: [] })!,
]);

describe('runDirectMatch', () => {
	it.each([
		['<p><img></p>', 'matched'],
		['<p></p>', 'unmatched'],
		['', 'unmatched'],
		['<!-- <img> --><p></p>', 'unmatched'],
		['<!-- <img>', 'unmatched'],
		['<![CDATA[ <img> ]]><p>', 'unmatched'],
		['<!DOCTYPE html><p>', 'unmatched'],
		['<script>"<img>"</script><p>', 'unmatched'],
		['<script>"<img>"</script><img>', 'matched'],
		['<script>"<img>"', 'unmatched'],
		['<noscript><img></noscript>', 'unmatched'],
		['<plaintext><img>', 'unmatched'],
		['<style>a{}</style><img>', 'matched'],
		['<template><img></template>', 'needs-tokenizer'],
		['<img><template><img></template>', 'matched'],
		['<p><TEMPLATE></TEMPLATE>', 'needs-tokenizer'],
		['<a title="<img>"></a>', 'unmatched'],
		['<a title="<template>"></a>', 'unmatched'],
		['<a title="x > <img>"></a><img>', 'matched'],
	])('%s → %s', (html, expected) => {
		expect(runDirectMatch(IMG, html)).toBe(expected);
	});

	it('restarts from the beginning on every call', () => {
		expect(runDirectMatch(IMG, '<img>')).toBe('matched');
		expect(runDirectMatch(IMG, '<img>')).toBe('matched');
		expect(runDirectMatch(IMG, '<p>')).toBe('unmatched');
	});

	it('does not rescan the rest of the document for every unterminated comment', () => {
		// A rescan per comment would take tens of seconds here; a linear scan takes
		// milliseconds, so the generous bound only fails on a complexity regression.
		const html = '<!-- '.repeat(20_000) + 'x'.repeat(1_000_000);
		const start = performance.now();
		expect(runDirectMatch(IMG, html)).toBe('unmatched');
		expect(performance.now() - start).toBeLessThan(5000);
	});
});
