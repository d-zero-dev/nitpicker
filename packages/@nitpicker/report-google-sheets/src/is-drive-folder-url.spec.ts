import { describe, it, expect } from 'vitest';

import { isDriveFolderUrl } from './is-drive-folder-url.js';

describe('isDriveFolderUrl', () => {
	it.each([
		['https://drive.google.com/drive/folders/abc123'],
		['https://drive.google.com/drive/u/1/folders/abc123?usp=sharing'],
	])('returns true for a Drive folder URL: %s', (url) => {
		expect(isDriveFolderUrl(url)).toBe(true);
	});

	it.each([
		['https://docs.google.com/spreadsheets/d/xyz789/edit#gid=0'],
		['https://drive.google.com/drive/my-drive'],
		['https://drive.google.com/open?id=abc123'],
		['not a url'],
		[''],
	])('returns false for a non-folder URL: %s', (url) => {
		expect(isDriveFolderUrl(url)).toBe(false);
	});
});
