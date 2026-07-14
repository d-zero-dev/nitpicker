import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import knex from 'knex';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Archive from './archive.js';
import { peekTarTopDir } from './filesystem/peek-tar-top-dir.js';
import { LibsqlDialect } from './libsql-dialect.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_migrate_to_0_13_script__');
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
const migrateScript = path.resolve(repoRoot, 'scripts', 'migrate-to-0.13.mjs');

/**
 * Builds a small but realistic 0.10 archive fixture via the production
 * `Archive.create` + `setPage` path so downstream migration steps see a
 * schema that matches what a real crawl would produce. Two pages, three
 * anchors (two pointing to the same href for dedup coverage), and one
 * shared external resource are inserted so the anchor-edges / resource
 * populate paths have data to work on.
 * @param filePath - Where to write the resulting `.nitpicker`.
 */
async function buildFixtureArchive(filePath: string): Promise<void> {
	const archive = await Archive.create({ filePath, cwd: workingDir });
	try {
		await archive.setPage({
			url: parseUrl('http://localhost/a')!,
			redirectPaths: [],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 100,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'Page A' },
			anchorList: [
				{
					href: parseUrl('http://localhost/b')!,
					textContent: 'link1',
					isExternal: false,
				},
				{
					href: parseUrl('http://localhost/b')!,
					textContent: 'link2',
					isExternal: false,
				},
			],
			imageList: [],
			html: '<html><body>a</body></html>',
			isSkipped: false,
			isTarget: true,
		});
		await archive.setPage({
			url: parseUrl('http://localhost/b')!,
			redirectPaths: [],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 100,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'Page B' },
			anchorList: [
				{ href: parseUrl('http://localhost/a')!, textContent: 'back', isExternal: false },
			],
			imageList: [],
			html: '<html><body>b</body></html>',
			isSkipped: false,
			isTarget: true,
		});
	} finally {
		await archive.close();
	}
}

/**
 * Computes a SHA-256 hex digest of a file. Used to prove the migration
 * script never mutates its input `.nitpicker` (the "restore .bak" clause
 * of issue #194 is satisfied by out-of-place output; the input is the
 * effective backup).
 * @param filePath - Absolute path to the file.
 */
function sha256File(filePath: string): string {
	const hash = createHash('sha256');
	hash.update(readFileSync(filePath));
	return hash.digest('hex');
}

/**
 * Repacks a fixture archive after opening its inner `db.sqlite` for a
 * caller-supplied mutation. Used to pre-populate 0.13 migration tables with a
 * phantom row so the migration's 0.13 verification fails.
 *
 * The mutation runs under `PRAGMA foreign_keys = OFF` so the caller can
 * insert rows referencing ids that will be created (or not) later by
 * `populate-url-refs.ts` — the phantom row is deliberately outside the
 * ref-populate contract.
 * @param filePath - Absolute path to the fixture `.nitpicker`.
 * @param mutate - Callback that receives a Knex handle on the extracted DB.
 */
async function mutateFixture(
	filePath: string,
	mutate: (db: ReturnType<typeof knex>) => Promise<void>,
): Promise<void> {
	const innerDirName = await peekTarTopDir(filePath);
	const stageDir = path.resolve(workingDir, `mutate-${process.pid}`);
	mkdirSync(stageDir, { recursive: true });
	try {
		await tar.x({ file: filePath, cwd: stageDir });
		const extracted = path.resolve(stageDir, innerDirName);
		const dbPath = path.resolve(extracted, 'db.sqlite');
		const db = knex({
			client: LibsqlDialect,
			connection: { filename: dbPath },
			useNullAsDefault: true,
		});
		try {
			await db.raw('PRAGMA foreign_keys = OFF');
			await mutate(db);
		} finally {
			await db.destroy();
		}
		rmSync(filePath, { force: true });
		await tar.c({ file: filePath, cwd: stageDir, portable: true }, [innerDirName]);
	} finally {
		rmSync(stageDir, { recursive: true, force: true });
	}
}

describe('scripts/migrate-to-0.13.mjs (integration)', () => {
	beforeEach(() => {
		mkdirSync(workingDir, { recursive: true });
	});
	afterEach(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it(
		'happy path: migrates a valid 0.10 archive and passes all 8 checks',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			await buildFixtureArchive(inputPath);

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			});
			expect(stdout.toString()).toContain('verification passed');

			expect(existsSync(outputPath)).toBe(true);

			const inspectDir = path.resolve(workingDir, 'inspect');
			mkdirSync(inspectDir, { recursive: true });
			await tar.x({ file: outputPath, cwd: inspectDir });
			const innerDirName = await peekTarTopDir(outputPath);
			const innerDbPath = path.resolve(inspectDir, innerDirName, 'db.sqlite');
			const db = knex({
				client: LibsqlDialect,
				connection: { filename: innerDbPath },
				useNullAsDefault: true,
			});
			try {
				const contentItemsCount = await db('content_items').count<{ n: number }[]>({
					n: '*',
				});
				const pagesCount = await db('pages').count<{ n: number }[]>({ n: '*' });
				expect(Number(contentItemsCount[0]!.n)).toBe(Number(pagesCount[0]!.n));
				const edgesCount = await db('anchor_edges').count<{ n: number }[]>({ n: '*' });
				expect(Number(edgesCount[0]!.n)).toBeGreaterThan(0);
				// The migrator's version-bump step bumps `info.version` so a
				// subsequent CLI open passes `assertCompatibleVersion`. Pin
				// that assertion — a bump-that-forgets-to-bump would
				// otherwise surface only as a downstream IncompatibleArchiveError
				// on next open, not here.
				const infoRows = await db('info').select('version');
				expect(infoRows.length).toBeGreaterThan(0);
				for (const row of infoRows) {
					expect(row.version).toBe('0.13.0');
				}
			} finally {
				await db.destroy();
			}
		},
	);

	it(
		'failure path: injects a row-count mismatch, aborts with a MigrationVerificationError, leaves the input intact and no output',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			await buildFixtureArchive(inputPath);
			await mutateFixture(inputPath, async (db) => {
				// Fresh archives from `Archive.create` already include the
				// 0.13 entity tables (initSchema calls their creators).
				// Insert a phantom `url_refs` + `content_items` pair so the
				// migration's entity populate 'INSERT OR IGNORE' leaves it untouched;
				// `count(content_items) > count(pages)` after entity populate → check #1
				// fires.
				await db('url_refs').insert({
					id: 999,
					url: 'http://localhost/phantom',
				});
				await db('content_items').insert({
					id: 999,
					url_id: 999,
					is_external: 0,
					scraped: 1,
					is_target: 1,
					source: 'crawled',
				});
			});
			const inputHashBefore = sha256File(inputPath);

			let thrown: Error | null = null;
			try {
				execFileSync('node', [migrateScript, inputPath, outputPath], {
					cwd: repoRoot,
					stdio: 'pipe',
				});
			} catch (error) {
				thrown = error as Error;
			}
			expect(thrown).not.toBeNull();
			const stderr = (
				(thrown as unknown as { stderr?: Buffer }).stderr ?? Buffer.from('')
			).toString();
			expect(stderr).toContain('migration verification failed');
			expect(stderr).toContain('#1');

			// Output tar was either never created, or created and then cleaned up.
			expect(existsSync(outputPath)).toBe(false);

			// Input tar bytes unchanged — the effective ".bak restore" clause.
			expect(sha256File(inputPath)).toBe(inputHashBefore);
		},
	);
});
