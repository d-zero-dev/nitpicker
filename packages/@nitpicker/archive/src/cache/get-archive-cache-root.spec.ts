import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getArchiveCacheRoot } from './get-archive-cache-root.js';

const ORIGINAL = process.env.NITPICKER_TAR_CACHE_DIR;

beforeEach(() => {
	delete process.env.NITPICKER_TAR_CACHE_DIR;
});

afterEach(() => {
	if (ORIGINAL === undefined) {
		delete process.env.NITPICKER_TAR_CACHE_DIR;
	} else {
		process.env.NITPICKER_TAR_CACHE_DIR = ORIGINAL;
	}
});

describe('getArchiveCacheRoot', () => {
	it('defaults to `<os.tmpdir()>/nitpicker/cache` so OS-level temp cleanup reclaims stale entries', () => {
		// Putting the cache under the OS temp dir is what lets us delegate
		// eviction (macOS reboot, systemd-tmpfiles, Windows Disk Cleanup)
		// instead of writing our own TTL logic.
		const expected = path.resolve(os.tmpdir(), 'nitpicker', 'cache');
		expect(getArchiveCacheRoot()).toBe(expected);
	});

	it('honours `NITPICKER_TAR_CACHE_DIR` for CI / operator overrides', () => {
		process.env.NITPICKER_TAR_CACHE_DIR = '/var/cache/nitpicker';
		expect(getArchiveCacheRoot()).toBe(path.resolve('/var/cache/nitpicker'));
	});

	it('resolves relative env paths against the current working directory so callers always see an absolute path', () => {
		// Absolute-path invariant: every cache helper assumes the root
		// resolves cleanly. If a relative path leaked through the env, the
		// downstream `path.resolve(cacheRoot, key)` could land in a
		// surprising location depending on the caller's CWD.
		process.env.NITPICKER_TAR_CACHE_DIR = './rel/cache';
		const root = getArchiveCacheRoot();
		expect(path.isAbsolute(root)).toBe(true);
		expect(root.endsWith(path.join('rel', 'cache'))).toBe(true);
	});

	it('treats an empty-string env override as unset (defaults still apply)', () => {
		process.env.NITPICKER_TAR_CACHE_DIR = '';
		const expected = path.resolve(os.tmpdir(), 'nitpicker', 'cache');
		expect(getArchiveCacheRoot()).toBe(expected);
	});
});
