import { describe, expect, it } from 'vitest';

import { joinUrlsForNote, NOTE_MAX_LENGTH } from './join-urls-for-note.js';

describe('joinUrlsForNote', () => {
	it('returns an empty string for an empty Set', () => {
		expect(joinUrlsForNote(new Set())).toBe('');
	});

	it('returns an empty string for an empty array', () => {
		expect(joinUrlsForNote([])).toBe('');
	});

	it('joins all URLs with newlines when they fit under the cap', () => {
		const set = new Set(['https://a.example/', 'https://b.example/']);
		expect(joinUrlsForNote(set, 100)).toBe('https://a.example/\nhttps://b.example/');
	});

	it('joins a plain array the same way as a Set', () => {
		expect(joinUrlsForNote(['https://a.example/', 'https://b.example/'], 100)).toBe(
			'https://a.example/\nhttps://b.example/',
		);
	});

	it('truncates with "... and N more" when the URL list exceeds the cap', () => {
		const urls = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'];
		// "aaaa" (4) + "\nbbbb" (5) = 9 used. Adding "\ncccc" would push to 14 (>12).
		expect(joinUrlsForNote(urls, 12)).toBe('aaaa\nbbbb\n... and 3 more');
	});

	it('reports "... and N more" with N counting every URL that did not fit', () => {
		const urls = ['aaa', 'bbb', 'ccc'];
		// "aaa" (3) used. Adding "\nbbb" would push to 7 (>4).
		// remaining = 3 - 2 + 1 = 2 (bbb and ccc).
		expect(joinUrlsForNote(urls, 4)).toBe('aaa\n... and 2 more');
	});

	it('handles the case where the very first URL already exceeds the cap', () => {
		expect(joinUrlsForNote(['toolong'], 3)).toBe('... and 1 more');
	});

	it('uses NOTE_MAX_LENGTH by default', () => {
		expect(joinUrlsForNote(['x', 'y', 'z'])).toBe('x\ny\nz');
		expect(NOTE_MAX_LENGTH).toBeGreaterThan(1000);
	});
});
