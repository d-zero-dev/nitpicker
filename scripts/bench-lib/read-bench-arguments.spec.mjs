import process from 'node:process';

import { describe, it, expect, vi, afterEach } from 'vitest';

import { readBenchArguments } from './read-bench-arguments.mjs';

describe('readBenchArguments', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('defaults to the bench’s first case', () => {
		expect(readBenchArguments('body-hash', ['site.nitpicker'])).toEqual({
			archive: 'site.nitpicker',
			caseName: 'rust',
			json: false,
		});
	});

	it('accepts the bench’s other cases', () => {
		expect(
			readBenchArguments('body-hash', ['site.nitpicker', '--case', 'js']).caseName,
		).toBe('js');
	});

	it('prints the error and the usage line, then exits with 1, on a usage error', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});
		expect(() =>
			readBenchArguments('body-hash', ['site.nitpicker', '--case', 'go']),
		).toThrow('exit');
		expect(exit).toHaveBeenCalledWith(1);
		expect(consoleError.mock.calls.map(([message]) => message)).toEqual([
			'Unknown case "go" (expected one of: rust, js)',
			'Usage: node scripts/bench-body-hash.mjs <archive.nitpicker> [--case rust|js] [--json]',
		]);
	});
});
