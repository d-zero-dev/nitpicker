import { describe, expect, it } from 'vitest';

import { findRawTextElementEnd } from './find-raw-text-element-end.js';

describe('findRawTextElementEnd', () => {
	it('returns the index just after the end tag', () => {
		const html = '<script>a<b</script><i>';
		expect(
			html.slice(findRawTextElementEnd({ html: html, name: 'script', from: 8 })),
		).toBe('<i>');
	});

	it.each(['</SCRIPT>', '</script >', '</script\n>', '</Script/>'])(
		'accepts %s',
		(end) => {
			const html = `<script>x${end}<i>`;
			expect(
				html.slice(findRawTextElementEnd({ html: html, name: 'script', from: 8 })),
			).toBe('<i>');
		},
	);

	it('does not stop at a longer name that starts the same', () => {
		const html = '<script>x</scripts>y</script><i>';
		expect(
			html.slice(findRawTextElementEnd({ html: html, name: 'script', from: 8 })),
		).toBe('<i>');
	});

	it('ends only on its own end tag', () => {
		const html = '<style>a</script>b</style><i>';
		expect(
			html.slice(findRawTextElementEnd({ html: html, name: 'style', from: 7 })),
		).toBe('<i>');
	});

	it('runs to the end of the document without an end tag, and for plaintext', () => {
		expect(findRawTextElementEnd({ html: '<script>x', name: 'script', from: 8 })).toBe(9);
		expect(
			findRawTextElementEnd({
				html: '<plaintext></plaintext><i>',
				name: 'plaintext',
				from: 11,
			}),
		).toBe(26);
	});

	it('is reusable across documents', () => {
		expect(
			findRawTextElementEnd({ html: '<script>a</script>', name: 'script', from: 8 }),
		).toBe(18);
		expect(
			findRawTextElementEnd({ html: '<script>a</script>', name: 'script', from: 8 }),
		).toBe(18);
		expect(
			findRawTextElementEnd({ html: '<script>aaaaaa</script>', name: 'script', from: 8 }),
		).toBe(23);
	});
});
