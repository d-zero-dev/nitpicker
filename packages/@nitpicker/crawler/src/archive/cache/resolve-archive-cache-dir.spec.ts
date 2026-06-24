import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveArchiveCacheDir } from './resolve-archive-cache-dir.js';

const CACHE_ROOT = path.resolve('/tmp/nitpicker-cache');
const KEY = '12345-67890-11111';

describe('resolveArchiveCacheDir', () => {
	it('joins the cache root with `<key>-<basename>` so the entry name is greppable on the filesystem', () => {
		const result = resolveArchiveCacheDir(
			CACHE_ROOT,
			KEY,
			'/some/where/example.nitpicker',
		);
		expect(result).toBe(path.resolve(CACHE_ROOT, `${KEY}-example`));
	});

	it('strips the `.nitpicker` extension from the basename so renaming the file does not change directory structure', () => {
		const result = resolveArchiveCacheDir(CACHE_ROOT, KEY, '/a/b/c.nitpicker');
		expect(result).toBe(path.resolve(CACHE_ROOT, `${KEY}-c`));
	});

	it('sanitises characters outside `[A-Za-z0-9._-]` so a crafted archive name cannot escape the cache root', () => {
		// Even though `path.basename` already drops directory components,
		// the explicit sanitisation guards against future code paths
		// that might forget to call `basename`, and removes Unicode /
		// space oddities that vary by filesystem.
		const result = resolveArchiveCacheDir(
			CACHE_ROOT,
			KEY,
			'/x/weird name with spaces!.nitpicker',
		);
		expect(result).toBe(path.resolve(CACHE_ROOT, `${KEY}-weird_name_with_spaces_`));
	});

	it('drops nothing dangerous when the basename contains only safe characters', () => {
		const result = resolveArchiveCacheDir(
			CACHE_ROOT,
			KEY,
			'/x/snapshot.2026-06-24_v1.nitpicker',
		);
		expect(result).toBe(path.resolve(CACHE_ROOT, `${KEY}-snapshot.2026-06-24_v1`));
	});

	it('caps basename length at 80 chars so absurdly long names do not blow past filesystem path limits', () => {
		// Some filesystems cap a single path component at 255 bytes;
		// truncating the basename keeps headroom for the key + path
		// separators on any production filesystem.
		const longName = 'a'.repeat(200) + '.nitpicker';
		const result = resolveArchiveCacheDir(CACHE_ROOT, KEY, `/x/${longName}`);
		const expectedBase = 'a'.repeat(80);
		expect(result).toBe(path.resolve(CACHE_ROOT, `${KEY}-${expectedBase}`));
	});

	it('collapses runs of disallowed chars into a single `_` so a punctuation-heavy name stays compact', () => {
		// `[^A-Za-z0-9._-]+` matches greedy runs, so `'!!!'` becomes a
		// single underscore instead of three. Keeps the directory name
		// readable when listing the cache root.
		const result = resolveArchiveCacheDir(CACHE_ROOT, KEY, '/x/!!!.nitpicker');
		expect(result).toBe(path.resolve(CACHE_ROOT, `${KEY}-_`));
	});

	it('falls back to just the key when the input is a bare root path (no basename to attach)', () => {
		// `path.basename('/')` returns '' — surfacing this case rather
		// than producing a `<key>-` directory keeps the layout predictable
		// even when an upstream caller passes a degenerate path.
		const result = resolveArchiveCacheDir(CACHE_ROOT, KEY, '/');
		expect(result).toBe(path.resolve(CACHE_ROOT, KEY));
	});
});
