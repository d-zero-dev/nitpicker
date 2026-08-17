import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findPackageDir } from './find-package-dir.js';

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-find-package-dir-test-'));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('findPackageDir', () => {
	it('見つかった場合、直下の node_modules から解決する', async () => {
		const packageDir = path.join(tmpDir, 'node_modules', 'some-package');
		await fs.mkdir(packageDir, { recursive: true });
		await fs.writeFile(path.join(packageDir, 'package.json'), '{}');

		expect(findPackageDir(tmpDir, 'some-package')).toBe(packageDir);
	});

	it('直下に無ければ親ディレクトリの node_modules まで遡って解決する（hoist されたケース）', async () => {
		const packageDir = path.join(tmpDir, 'node_modules', 'some-package');
		await fs.mkdir(packageDir, { recursive: true });
		await fs.writeFile(path.join(packageDir, 'package.json'), '{}');

		const nestedFromDir = path.join(tmpDir, 'node_modules', 'consumer', 'src', 'nested');
		await fs.mkdir(nestedFromDir, { recursive: true });

		expect(findPackageDir(nestedFromDir, 'some-package')).toBe(packageDir);
	});

	it('直下と祖先の両方にあれば、より近い（直下寄りの）ものを優先する', async () => {
		const nestedConsumerDir = path.join(tmpDir, 'node_modules', 'consumer');
		const nearPackageDir = path.join(nestedConsumerDir, 'node_modules', 'some-package');
		await fs.mkdir(nearPackageDir, { recursive: true });
		await fs.writeFile(path.join(nearPackageDir, 'package.json'), '{}');

		const farPackageDir = path.join(tmpDir, 'node_modules', 'some-package');
		await fs.mkdir(farPackageDir, { recursive: true });
		await fs.writeFile(path.join(farPackageDir, 'package.json'), '{}');

		expect(findPackageDir(nestedConsumerDir, 'some-package')).toBe(nearPackageDir);
	});

	it('どこにも見つからなければ、探索起点を含むエラーを投げる', () => {
		expect(() => {
			findPackageDir(tmpDir, 'nonexistent-package');
		}).toThrow(`Could not locate "nonexistent-package" from ${tmpDir}`);
	});
});
