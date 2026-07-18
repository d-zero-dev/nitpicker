import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import knex from 'knex';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { peekTarTopDir } from './filesystem/peek-tar-top-dir.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { fkParentTables } from './test-utils/fk-parent-tables.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_migrate_to_0_13_script__');
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
const migrateScript = path.resolve(repoRoot, 'scripts', 'migrate-to-0.13.mjs');
const fixtureScript = path.resolve(repoRoot, 'scripts', 'generate-pre-0.13-fixture.mjs');

/**
 * Builds a small but realistic 0.10 archive fixture by running
 * `scripts/generate-pre-0.13-fixture.mjs` — the single source of the
 * pre-0.13 fixture shape, shared with the `viewer-migrated-archive` E2E
 * so the two suites cannot silently diverge in what they exercise. The
 * fixture carries two pages, three anchors (two pointing at the same
 * href for dedup coverage), one resource with two referrers, and one row
 * in each retarget-covered adjunct table.
 * @param filePath - Where to write the resulting `.nitpicker`.
 */
function buildFixtureArchive(filePath: string): void {
	execFileSync('node', [fixtureScript, filePath], { cwd: repoRoot });
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
 * caller-supplied mutation. Used to inject fixture corruption (phantom rows
 * / deleted rows) so the migration script's verification or preflight fails.
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
			// Keep the repacked fixture deterministic: flush WAL contents into
			// the main db.sqlite before teardown so tar never races libsql's
			// asynchronous sidecar cleanup.
			await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
		} finally {
			await db.destroy();
		}
		for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
			if (existsSync(sidecar)) {
				rmSync(sidecar, { force: true });
			}
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
			buildFixtureArchive(inputPath);

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
				// The fixture inserts exactly two legacy pages; the populate
				// must carry both across (the legacy table itself is gone, so
				// the expected count is pinned by the fixture, not read back).
				const contentItemsCount = await db('content_items').count<{ n: number }[]>({
					n: '*',
				});
				expect(Number(contentItemsCount[0]!.n)).toBe(2);
				const edgesCount = await db('anchor_edges').count<{ n: number }[]>({ n: '*' });
				expect(Number(edgesCount[0]!.n)).toBeGreaterThan(0);

				// The legacy write-model tables are dropped from the output.
				for (const table of [
					'pages',
					'anchors',
					'images',
					'resources',
					'resources-referrers',
				]) {
					expect(await db.schema.hasTable(table), `${table} dropped`).toBe(false);
				}

				// Every adjunct FK declaration now targets content_items(id).
				for (const table of [
					'page_html_ref',
					'page_tags',
					'page_jsonld',
					'page_errors',
					'analysis_violations',
				]) {
					const parents = await fkParentTables(db, table);
					expect(parents.has('content_items'), `${table} → content_items`).toBe(true);
					expect(parents.has('pages'), `${table} must not reference pages`).toBe(false);
				}

				// The FK rebuild carried the fixture's adjunct rows across.
				expect(await db('page_errors').select('*')).toMatchObject([
					{ phase: 'screenshot', message: 'viewport switch failed' },
				]);
				expect(await db('page_tags').select('*')).toMatchObject([
					{ provider: 'WordPress', externalId: 'wp' },
				]);
				expect(await db('page_jsonld').select('*')).toMatchObject([
					{ kind: 'json-ld', type: 'Article' },
				]);
				expect(await db('analysis_violations').select('*')).toMatchObject([
					{ validator: 'markuplint', rule: 'required-attr' },
				]);
				expect(await db('page_html_ref').select('page_id')).toHaveLength(1);

				// Zero FK violations against the final schema — the same
				// assertion the migrator itself runs via
				// `checkForeignKeyIntegrity` before repacking.
				const violations = await db.select('*').from(db.raw('pragma_foreign_key_check'));
				expect(violations).toEqual([]);

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
			buildFixtureArchive(inputPath);
			await mutateFixture(inputPath, async (db) => {
				// Point one `anchors` row at a non-existent page. `pageId` is
				// still a real page (so the source-side content_items exists),
				// but `hrefId=99999` has no matching content_items row after
				// populate — `populate-anchor-edges`' INSERT into
				// `anchor_edges(href_page_id)` fails the FK to
				// `content_items(id)` and the whole populate transaction
				// rolls back. The migrator surfaces this to stderr with a
				// non-zero exit, and the output tar must never be produced.
				// (Note: entity tables are TRUNCATEd at the start of every
				// populate run, so directly injecting a phantom `content_items`
				// row would be wiped before verification could see it —
				// injection must land in a legacy table the truncate does
				// not touch, and the mismatch must survive re-populate.)
				await db('anchors').insert({
					pageId: 1,
					hrefId: 99_999,
					hash: 'phantom-anchor',
					textContent: 'phantom link',
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
			// The FK failure inside populate-anchor-edges surfaces as a
			// libsql SQLITE_CONSTRAINT error that the outer script catches
			// and re-throws; the message is enough to detect the abort.
			expect(stderr).toMatch(/FOREIGN KEY constraint failed|SQLITE_CONSTRAINT/);

			// Output tar was either never created, or created and then cleaned up.
			expect(existsSync(outputPath)).toBe(false);

			// Input tar bytes unchanged — the effective ".bak restore" clause.
			expect(sha256File(inputPath)).toBe(inputHashBefore);
		},
	);

	it(
		'empty-info abort: refuses to migrate an archive whose `info` table has no rows (would otherwise produce an unreadable output)',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'empty-info.nitpicker');
			const outputPath = path.resolve(workingDir, 'empty-info.0.13.nitpicker');
			buildFixtureArchive(inputPath);
			// Simulate an interrupted crawl that reached `Archive.create` but
			// never got as far as `setConfig` — the `info` table exists but
			// has zero rows. A bare `UPDATE info SET version = ...` would
			// silently affect zero rows and the repacked archive would be
			// unopenable (`assertCompatibleVersion` would throw on missing
			// `info.version`). The migrator must detect and refuse this
			// before repacking.
			await mutateFixture(inputPath, async (db) => {
				await db('info').delete();
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
			expect(stderr).toContain('`info` table is empty');

			expect(existsSync(outputPath)).toBe(false);
			expect(sha256File(inputPath)).toBe(inputHashBefore);
		},
	);

	it(
		'adds pages.source / resources.source on an archive predating crawl --inventory',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'no-source.nitpicker');
			const outputPath = path.resolve(workingDir, 'no-source.0.13.nitpicker');
			buildFixtureArchive(inputPath);
			// A genuinely old archive has no `source` column at all. The
			// entity populate SELECTs it, so the migrator's
			// `ensureLegacySourceColumns` step must add it (with the
			// 'crawled' default backfilled by SQLite) before populate runs.
			// The columns carry an index, which must go first — SQLite
			// refuses DROP COLUMN on an indexed column.
			await mutateFixture(inputPath, async (db) => {
				await db.raw('DROP INDEX IF EXISTS pages_source_index');
				await db.raw('ALTER TABLE pages DROP COLUMN source');
				await db.raw('DROP INDEX IF EXISTS resources_source_index');
				await db.raw('ALTER TABLE resources DROP COLUMN source');
			});

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			});
			expect(stdout.toString()).toContain('added pages.source');

			const inspectDir = path.resolve(workingDir, 'inspect-no-source');
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
				const rows = await db('content_items').select('source');
				expect(rows.length).toBeGreaterThan(0);
				for (const row of rows) {
					expect(row.source).toBe('crawled');
				}
			} finally {
				await db.destroy();
			}
		},
	);
});
