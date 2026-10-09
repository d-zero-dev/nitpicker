import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

const packageDir = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
	exports: Record<string, { import: string; types: string }>;
};
const entries = Object.entries(pkg.exports);

describe('@nitpicker/archive package.json exports', () => {
	it('does not export the package root (subpath exports only)', () => {
		expect(pkg.exports['.']).toBeUndefined();
	});

	it.each(entries)(
		'%s maps to an existing source file with matching lib paths',
		(subpath, target) => {
			const sub = subpath.slice('./'.length);
			expect(target).toEqual({ import: `./lib/${sub}.js`, types: `./lib/${sub}.d.ts` });
			expect(existsSync(path.join(packageDir, 'src', `${sub}.ts`))).toBe(true);
		},
	);
});
