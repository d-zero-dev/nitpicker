import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const templateClassificationDir = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.join(templateClassificationDir, 'page-cluster');
const archiveSrcDir = path.resolve(templateClassificationDir, '..');
const archivePackageJsonPath = path.resolve(archiveSrcDir, '..', 'package.json');

/**
 * Module specifiers a TypeScript source actually imports — comments and
 * JSDoc `@example` blocks are ignored, unlike a plain text search.
 * @param filePath - Absolute path to a `.ts` / `.tsx` file.
 * @returns The specifiers of every static and dynamic import in the file.
 */
function listImportSpecifiers(filePath: string): string[] {
	const source = readFileSync(filePath, 'utf8');
	return ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName);
}

/**
 * Lists every `.ts` / `.tsx` file under `dir`, recursively.
 * @param dir - Directory to walk.
 * @returns Absolute file paths.
 */
function listSourceFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter((relativePath) => /\.tsx?$/.test(relativePath))
		.map((relativePath) => path.join(dir, relativePath));
}

describe('page-cluster エンジンの境界', () => {
	it('エンジンはディレクトリ内の相対 import と htmlparser2・@d-zero/shared・node 組み込み・vitest 以外を import しない', () => {
		const specifiers = listSourceFiles(engineDir).flatMap((filePath) =>
			listImportSpecifiers(filePath),
		);

		expect(specifiers.filter((specifier) => specifier.startsWith('../'))).toEqual([]);
		expect(
			[
				...new Set(specifiers.filter((specifier) => !specifier.startsWith('.'))),
			].toSorted(),
		).toEqual([
			'@d-zero/shared/hash',
			'@d-zero/shared/sort/alphabetical',
			'htmlparser2',
			'node:fs',
			'node:path',
			'node:url',
			'vitest',
		]);
	});

	it('archive 内でエンジンを import するのは template-classification の 3 ファイル（と分類の spec）だけ', () => {
		const importers = listSourceFiles(archiveSrcDir)
			.filter((filePath) => !filePath.startsWith(engineDir + path.sep))
			.filter((filePath) =>
				listImportSpecifiers(filePath).some((specifier) =>
					specifier.includes('page-cluster/'),
				),
			)
			.map((filePath) => path.relative(archiveSrcDir, filePath))
			.toSorted();

		expect(importers).toEqual([
			'template-classification/classify-page-templates.spec.ts',
			'template-classification/classify-page-templates.ts',
			'template-classification/create-content-root-hint.ts',
			'template-classification/create-page-cluster-factory.ts',
		]);
	});

	it('エンジンは archive の exports に載らない', () => {
		const packageJson = JSON.parse(readFileSync(archivePackageJsonPath, 'utf8')) as {
			exports: Record<string, unknown>;
		};

		expect(
			Object.keys(packageJson.exports).filter((key) => key.includes('page-cluster')),
		).toEqual([]);
	});
});
