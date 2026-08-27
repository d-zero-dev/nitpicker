import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveOutputPath } from './resolve-output-path.js';

describe('resolveOutputPath', () => {
	it('uses the archive basename in the current directory by default', () => {
		expect(resolveOutputPath('/tmp/example.nitpicker')).toBe(
			path.resolve(process.cwd(), 'example.html'),
		);
	});

	it('resolves an explicit relative destination from the current directory', () => {
		expect(resolveOutputPath('/tmp/example.nitpicker', 'reports/site.html')).toBe(
			path.resolve(process.cwd(), 'reports/site.html'),
		);
	});
});
