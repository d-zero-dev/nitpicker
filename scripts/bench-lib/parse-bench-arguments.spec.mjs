import { describe, it, expect } from 'vitest';

import { parseBenchArguments } from './parse-bench-arguments.mjs';

const spec = { cases: ['rust', 'js'], defaultCase: 'rust' };

describe('parseBenchArguments', () => {
	it('uses the default case and human output when only the archive is given', () => {
		expect(parseBenchArguments(['site.nitpicker'], spec)).toEqual({
			archive: 'site.nitpicker',
			caseName: 'rust',
			json: false,
		});
	});

	it('reads --case and --json in any position', () => {
		expect(
			parseBenchArguments(['--json', 'site.nitpicker', '--case', 'js'], spec),
		).toEqual({ archive: 'site.nitpicker', caseName: 'js', json: true });
	});

	it('rejects any other option', () => {
		expect(() => parseBenchArguments(['site.nitpicker', '--cse', 'js'], spec)).toThrow(
			'Unknown option --cse',
		);
	});

	it('rejects a missing archive', () => {
		expect(() => parseBenchArguments(['--case', 'js'], spec)).toThrow(
			'Missing the archive path',
		);
	});

	it('rejects an unknown case and lists the known ones', () => {
		expect(() => parseBenchArguments(['site.nitpicker', '--case', 'go'], spec)).toThrow(
			'Unknown case "go" (expected one of: rust, js)',
		);
	});

	it('rejects --case at the end of the line', () => {
		expect(() => parseBenchArguments(['site.nitpicker', '--case'], spec)).toThrow(
			'--case needs a value',
		);
	});

	it('rejects --case followed by another flag', () => {
		expect(() =>
			parseBenchArguments(['site.nitpicker', '--case', '--json'], spec),
		).toThrow('--case needs a value');
	});

	it('rejects --case given twice', () => {
		expect(() =>
			parseBenchArguments(['site.nitpicker', '--case', 'rust', '--case', 'js'], spec),
		).toThrow('--case is given more than once');
	});

	it('rejects a second positional argument', () => {
		expect(() => parseBenchArguments(['a.nitpicker', 'b.nitpicker'], spec)).toThrow(
			'Unexpected extra argument: b.nitpicker',
		);
	});
});
