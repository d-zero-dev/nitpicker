import { describe, expect, it } from 'vitest';

import { validateDirectoryFlag } from './validate-directory-flag.js';

describe('validateDirectoryFlag', () => {
	it.each(['pages', 'search-html', 'match-selector'] as const)(
		'rejects a blank or non-HTTP --directory for %s, naming the flag',
		(subCommand) => {
			expect(() => validateDirectoryFlag(subCommand, ' ')).toThrow(
				'Invalid --directory value: " " (directory filter must not be blank',
			);
			expect(() => validateDirectoryFlag(subCommand, 'ftp://example.com/blog')).toThrow(
				'Invalid --directory value: "ftp://example.com/blog"',
			);
		},
	);

	it('accepts a pathname, a full URL and /', () => {
		expect(() => validateDirectoryFlag('pages', '/blog')).not.toThrow();
		expect(() =>
			validateDirectoryFlag('pages', 'https://example.com/blog'),
		).not.toThrow();
		expect(() => validateDirectoryFlag('pages', '/')).not.toThrow();
	});

	it('ignores the flag when it is absent or the sub-command does not read it', () => {
		expect(() => validateDirectoryFlag('pages')).not.toThrow();
		expect(() => validateDirectoryFlag('summary', ' ')).not.toThrow();
	});
});
