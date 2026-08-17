import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Locates `packageName`'s directory the way Node's module resolution would —
 * walking `node_modules` upward from `fromDir` — without going through the
 * package's own `exports` map.
 *
 * A plain `require.resolve()` on an ESM-only package (`exports` declaring
 * only the `"import"` condition) fails from a CJS `createRequire` context,
 * and there is no stable public API to run Node's ESM resolution algorithm
 * from an arbitrary base directory. Walking `node_modules` directly
 * sidesteps the `exports` map entirely — it only needs the package's
 * directory, not its resolved entry file.
 * @param fromDir - Directory to start walking upward from.
 * @param packageName - Package name to locate (e.g. `puppeteer`,
 *   `@d-zero/beholder`).
 * @throws {Error} When no `node_modules/<packageName>` directory is found
 *   between `fromDir` and the filesystem root.
 * @example
 * ```ts
 * import { findPackageDir } from './find-package-dir.js';
 *
 * const puppeteerDir = findPackageDir(import.meta.dirname, 'puppeteer');
 * ```
 */
export function findPackageDir(fromDir: string, packageName: string): string {
	let dir = fromDir;
	for (;;) {
		const candidate = path.join(dir, 'node_modules', packageName);
		if (existsSync(path.join(candidate, 'package.json'))) {
			return candidate;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`Could not locate "${packageName}" from ${fromDir}`);
		}
		dir = parent;
	}
}
