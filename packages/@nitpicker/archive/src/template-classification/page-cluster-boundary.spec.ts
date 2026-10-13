import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const templateClassificationDir = path.dirname(fileURLToPath(import.meta.url));
const driverDir = path.join(templateClassificationDir, 'page-cluster');
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

describe('page-cluster ドライバの境界', () => {
	it('ドライバはディレクトリ内の相対 import と @nitpicker/core・vitest 以外を import しない', () => {
		const specifiers = listSourceFiles(driverDir).flatMap((filePath) =>
			listImportSpecifiers(filePath),
		);

		expect(specifiers.filter((specifier) => specifier.startsWith('../'))).toEqual([]);
		expect(
			[
				...new Set(specifiers.filter((specifier) => !specifier.startsWith('.'))),
			].toSorted(),
		).toEqual([
			'@nitpicker/core/create-template-classification-run',
			'@nitpicker/core/template-block-sample-size',
			'@nitpicker/core/template-corpus-inline-threshold',
			'@nitpicker/core/types',
			'vitest',
		]);
	});

	it('archive 内でドライバを import するのは template-classification の 2 ファイル（と分類の spec・golden）だけ', () => {
		const importers = listSourceFiles(archiveSrcDir)
			.filter((filePath) => !filePath.startsWith(driverDir + path.sep))
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
			'template-classification/create-page-cluster-factory.ts',
			'template-classification/golden/classify-golden-corpus.ts',
		]);
	});

	it('ドライバは archive の exports に載らない', () => {
		const packageJson = JSON.parse(readFileSync(archivePackageJsonPath, 'utf8')) as {
			exports: Record<string, unknown>;
		};

		expect(
			Object.keys(packageJson.exports).filter((key) => key.includes('page-cluster')),
		).toEqual([]);
	});
});
