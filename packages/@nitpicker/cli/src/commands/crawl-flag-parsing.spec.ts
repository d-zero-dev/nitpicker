import { parseCli } from '@d-zero/roar';
import { describe, expect, it } from 'vitest';

import { commandDef } from './crawl.js';

/**
 * Run `parseCli` against a fabricated `process.argv` and return the parsed
 * result. Restores `process.argv` after the call so tests stay isolated.
 * @param argv - Args from the user's perspective (no `node ...cli.js` prefix).
 * @returns The `RoarResult` produced by `parseCli`.
 */
function runParse(argv: string[]) {
	const original = process.argv;
	process.argv = ['node', 'cli.js', 'crawl', ...argv];
	try {
		return parseCli({
			name: 'nitpicker',
			version: '0.0.0-test',
			commands: { crawl: commandDef },
			onError: () => true,
		});
	} finally {
		process.argv = original;
	}
}

describe('crawl CLI flag parsing (parseCli integration)', () => {
	it('aggregates repeated --append into a string array', () => {
		const result = runParse([
			'./existing.nitpicker',
			'--append',
			'https://a.example.com/',
			'--append',
			'https://b.example.com/',
		]);

		expect(result.command).toBe('crawl');
		expect(result.args).toEqual(['./existing.nitpicker']);
		expect(result.flags.append).toEqual([
			'https://a.example.com/',
			'https://b.example.com/',
		]);
	});

	it('aggregates repeated -A short flag the same way', () => {
		const result = runParse([
			'./existing.nitpicker',
			'-A',
			'https://a.example.com/',
			'-A',
			'https://b.example.com/',
		]);

		expect(result.args).toEqual(['./existing.nitpicker']);
		expect(result.flags.append).toEqual([
			'https://a.example.com/',
			'https://b.example.com/',
		]);
	});

	it('leaves append as undefined when the flag is not supplied', () => {
		// roar's InferFlags types `isMultiple: true` flags as `string[]`, but at
		// runtime an absent flag is `undefined`. Lock this behaviour in so the
		// dispatcher's `!!flags.append && flags.append.length > 0` guard is the
		// only safe pattern to rely on.
		const result = runParse(['https://example.com/']);
		expect(result.flags.append).toBeUndefined();
	});
});
