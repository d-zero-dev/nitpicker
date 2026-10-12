import { describe, it, expect } from 'vitest';

import { parseSuiteArguments } from './parse-suite-arguments.mjs';

const BENCHES = ['body-hash', 'search-html'];

describe('parseSuiteArguments', () => {
	it('selects every bench when no --only is given', () => {
		expect(parseSuiteArguments(['site.nitpicker'], BENCHES)).toEqual({
			archive: 'site.nitpicker',
			only: new Set(),
		});
	});

	it('collects repeated --only filters', () => {
		expect(
			parseSuiteArguments(
				['--only', 'body-hash', 'site.nitpicker', '--only', 'search-html'],
				BENCHES,
			),
		).toEqual({ archive: 'site.nitpicker', only: new Set(['body-hash', 'search-html']) });
	});

	it('rejects --only without a name', () => {
		expect(() => parseSuiteArguments(['site.nitpicker', '--only'], BENCHES)).toThrow(
			'--only needs a bench name',
		);
	});

	it('rejects an unknown bench name and lists the known ones', () => {
		expect(() =>
			parseSuiteArguments(['site.nitpicker', '--only', 'bodyhash'], BENCHES),
		).toThrow('Unknown bench "bodyhash" (expected one of: body-hash, search-html)');
	});

	it('rejects an unknown flag instead of taking it as the archive', () => {
		expect(() => parseSuiteArguments(['site.nitpicker', '--json'], BENCHES)).toThrow(
			'Unknown option --json',
		);
	});

	it('rejects a second archive', () => {
		expect(() => parseSuiteArguments(['a.nitpicker', 'b.nitpicker'], BENCHES)).toThrow(
			'Unexpected extra argument: b.nitpicker',
		);
	});

	it('rejects a missing archive', () => {
		expect(() => parseSuiteArguments(['--only', 'body-hash'], BENCHES)).toThrow(
			'Missing the archive path',
		);
	});
});
