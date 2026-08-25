import { describe, expect, it } from 'vitest';

import { NOTE_MAX_LENGTH } from './join-urls-for-note.js';
import { truncateNoteText } from './truncate-note-text.js';

describe('truncateNoteText', () => {
	it('returns the text unchanged when it fits under the cap', () => {
		expect(truncateNoteText('hello', 100)).toBe('hello');
	});

	it('returns an empty string unchanged', () => {
		expect(truncateNoteText('', 100)).toBe('');
	});

	it('truncates and appends a marker when the text exceeds the cap', () => {
		const text = 'a'.repeat(200);
		const result = truncateNoteText(text, 100);
		expect(result.length).toBeLessThanOrEqual(100);
		expect(result).toContain('...(truncated: showing first 100 of 200 characters)');
	});

	it('keeps the total length within maxLength even with the marker included', () => {
		const text = 'x'.repeat(10_000);
		const result = truncateNoteText(text, 60);
		expect(result.length).toBeLessThanOrEqual(60);
	});

	it('uses NOTE_MAX_LENGTH by default', () => {
		const text = 'a'.repeat(NOTE_MAX_LENGTH + 1);
		const result = truncateNoteText(text);
		expect(result.length).toBeLessThanOrEqual(NOTE_MAX_LENGTH);
	});
});
