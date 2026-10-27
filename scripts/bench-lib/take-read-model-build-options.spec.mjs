import { describe, it, expect } from 'vitest';

import { takeReadModelBuildOptions } from './take-read-model-build-options.mjs';

describe('takeReadModelBuildOptions', () => {
	it('leaves a line without its options untouched', () => {
		expect(takeReadModelBuildOptions(['site.nitpicker', '--case', 'full'])).toEqual({
			rest: ['site.nitpicker', '--case', 'full'],
			pragmas: [],
			regions: false,
			gc: false,
		});
	});

	it('takes every --pragma name=value pair out, in order, and the --regions / --gc flags', () => {
		expect(
			takeReadModelBuildOptions([
				'--pragma',
				'cache_spill=false',
				'site.nitpicker',
				'--regions',
				'--pragma',
				'wal_autocheckpoint=0',
				'--gc',
				'--json',
			]),
		).toEqual({
			rest: ['site.nitpicker', '--json'],
			pragmas: [
				{ name: 'cache_spill', value: 'false' },
				{ name: 'wal_autocheckpoint', value: '0' },
			],
			regions: true,
			gc: true,
		});
	});

	it('accepts a negative number value', () => {
		expect(
			takeReadModelBuildOptions(['a', '--pragma', 'cache_spill=-1']).pragmas,
		).toEqual([{ name: 'cache_spill', value: '-1' }]);
	});

	it('rejects the PRAGMAs the build sets itself, so the report never names a setting the build overwrote', () => {
		expect(() => takeReadModelBuildOptions(['a', '--pragma', 'mmap_size=0'])).toThrow(
			'--pragma mmap_size cannot be varied: the build sets it itself (withBulkWritePragmas)',
		);
		expect(() => takeReadModelBuildOptions(['a', '--pragma', 'cache_size=0'])).toThrow(
			'--pragma cache_size cannot be varied: the build sets it itself (withBulkWritePragmas)',
		);
	});

	it('accepts temp_store, which the build leaves as the connection has it', () => {
		expect(
			takeReadModelBuildOptions(['a', '--pragma', 'temp_store=FILE']).pragmas,
		).toEqual([{ name: 'temp_store', value: 'FILE' }]);
	});

	it('rejects --pragma without a value', () => {
		expect(() => takeReadModelBuildOptions(['a', '--pragma'])).toThrow(
			'--pragma needs a name=value',
		);
		expect(() => takeReadModelBuildOptions(['a', '--pragma', '--json'])).toThrow(
			'--pragma needs a name=value',
		);
	});

	it('rejects a pragma that is not a plain name=value, so nothing else reaches the SQL', () => {
		expect(() => takeReadModelBuildOptions(['a', '--pragma', 'mmap_size'])).toThrow(
			'--pragma needs a name=value',
		);
		expect(() =>
			takeReadModelBuildOptions(['a', '--pragma', 'cache_size=1; DROP TABLE x']),
		).toThrow('Invalid pragma "cache_size=1; DROP TABLE x"');
		expect(() => takeReadModelBuildOptions(['a', '--pragma', 'x-y=1'])).toThrow(
			'Invalid pragma "x-y=1"',
		);
	});
});
