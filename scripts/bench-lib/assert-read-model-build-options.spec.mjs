import { describe, it, expect } from 'vitest';

import { assertReadModelBuildOptions } from './assert-read-model-build-options.mjs';

describe('assertReadModelBuildOptions', () => {
	it('accepts a full run with every flag when gc is available', () => {
		expect(() =>
			assertReadModelBuildOptions({
				caseName: 'full',
				regions: true,
				gc: true,
				gcAvailable: true,
			}),
		).not.toThrow();
	});

	it('accepts a floor run without the sampling flags', () => {
		expect(() =>
			assertReadModelBuildOptions({
				caseName: 'floor',
				regions: false,
				gc: false,
				gcAvailable: false,
			}),
		).not.toThrow();
	});

	it('rejects --gc when the process was not started with --expose-gc', () => {
		expect(() =>
			assertReadModelBuildOptions({
				caseName: 'full',
				regions: false,
				gc: true,
				gcAvailable: false,
			}),
		).toThrow('--gc needs `node --expose-gc`');
	});

	it('rejects --regions on the floor case', () => {
		expect(() =>
			assertReadModelBuildOptions({
				caseName: 'floor',
				regions: true,
				gc: false,
				gcAvailable: true,
			}),
		).toThrow('--regions and --gc have no effect on --case floor');
	});

	it('rejects --gc on the floor case even when gc is available', () => {
		expect(() =>
			assertReadModelBuildOptions({
				caseName: 'floor',
				regions: false,
				gc: true,
				gcAvailable: true,
			}),
		).toThrow('--regions and --gc have no effect on --case floor');
	});
});
