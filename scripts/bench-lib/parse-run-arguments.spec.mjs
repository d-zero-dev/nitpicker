import { describe, it, expect } from 'vitest';

import { parseRunArguments } from './parse-run-arguments.mjs';

const CASES = { 'body-hash': ['rust', 'js'], 'tech-signals': ['default'] };

describe('parseRunArguments', () => {
	it('reads the bench, the archive and the case', () => {
		expect(
			parseRunArguments(['body-hash', 'site.nitpicker', '--case', 'js'], CASES),
		).toEqual({ bench: 'body-hash', archive: 'site.nitpicker', caseName: 'js' });
	});

	it('rejects a bench that is not a baseline one', () => {
		expect(() =>
			parseRunArguments(['isolated', 'site.nitpicker', '--case', 'default'], CASES),
		).toThrow('Unknown bench "isolated" (expected one of: body-hash, tech-signals)');
	});

	it('rejects a case the bench does not have', () => {
		expect(() =>
			parseRunArguments(['body-hash', 'site.nitpicker', '--case', 'go'], CASES),
		).toThrow('Unknown case "go" (expected one of: rust, js)');
	});

	it('rejects any other argument', () => {
		expect(() =>
			parseRunArguments(
				['body-hash', 'site.nitpicker', '--case', 'js', '--sample', '10'],
				CASES,
			),
		).toThrow('Unexpected argument: --sample');
	});

	it('rejects a missing bench name', () => {
		expect(() => parseRunArguments([], CASES)).toThrow('Missing the bench name');
	});

	it('rejects a flag where the bench name belongs', () => {
		expect(() => parseRunArguments(['--case', 'js', 'site.nitpicker'], CASES)).toThrow(
			'Missing the bench name',
		);
	});

	it('rejects --case given twice', () => {
		expect(() =>
			parseRunArguments(
				['body-hash', 'site.nitpicker', '--case', 'rust', '--case', 'js'],
				CASES,
			),
		).toThrow('--case is given more than once');
	});

	it('rejects a missing archive', () => {
		expect(() => parseRunArguments(['body-hash', '--case', 'js'], CASES)).toThrow(
			'Missing the archive path',
		);
	});

	it('rejects a missing --case', () => {
		expect(() => parseRunArguments(['body-hash', 'site.nitpicker'], CASES)).toThrow(
			'--case <case> is required',
		);
	});

	it('rejects --case followed by another flag', () => {
		expect(() =>
			parseRunArguments(['body-hash', 'site.nitpicker', '--case', '--json'], CASES),
		).toThrow('--case <case> is required');
	});
});
