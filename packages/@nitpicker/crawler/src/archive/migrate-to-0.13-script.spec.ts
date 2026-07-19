import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

import knex from 'knex';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireArchiveLock } from './archive-lock.js';
import { createAdjunctTables } from './create-adjunct-tables.js';
import { peekTarTopDir } from './filesystem/peek-tar-top-dir.js';
import { LibsqlDialect } from './libsql-dialect.js';
import { migrateEntityTables } from './migrate-entity-tables.js';
import { migrateRefTables } from './migrate-ref-tables.js';
import { populateEntityTables } from './populate-entity-tables/populate-entities.js';
import { populateContentTypeRefs } from './populate-ref-tables/populate-content-type-refs.js';
import { populateRefTables } from './populate-ref-tables/populate-refs.js';
import { populateUrlRefs } from './populate-ref-tables/populate-url-refs.js';
import { retargetLegacyFkTables } from './retarget-legacy-fk-tables.js';
import { fkParentTables } from './test-utils/fk-parent-tables.js';
import { verifyMigration } from './verify-migration/verify-migration.js';

/**
 * No-op stub for `populateEntityTables`'s DOM-path resolver: test fixtures
 * carry no real HTML snapshots, so every image falls back to the
 * synthetic "unknown" marker regardless of what the resolver returns.
 */
const noopDomPathResolver = () => Promise.resolve(new Map());

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

/**
 * Mirrors `scripts/migrate-to-0.13.mjs`'s deterministic work-dir naming
 * (output-path basename, no PID) so specs can construct or inspect the
 * exact directory the script will use for a given output path without
 * ever running the script first.
 * @param outputPath - The output `.nitpicker` path the script would be
 *   invoked with.
 */
function deriveWorkDir(outputPath: string): string {
	return path.resolve(
		path.dirname(outputPath),
		`._migrate-to-0.13-${path.basename(outputPath, path.extname(outputPath))}`,
	);
}

/**
 * Builds a work dir that looks, from the script's point of view, exactly
 * like a completed untar from a prior (possibly killed) run: extracted
 * contents, the `.untar-complete` sentinel, and a `.source-fingerprint.json`
 * matching `fingerprintSourcePath` — mirroring
 * `scripts/migrate-to-0.13.mjs`'s own `writeSourceFingerprint`, since the
 * script now refuses to resume a work dir whose fingerprint doesn't match
 * the input path it was invoked with.
 *
 * `archiveToExtract` and `fingerprintSourcePath` are deliberately separate
 * parameters: a test simulating "resumed past the legacy-table drop" seeds
 * the work dir's contents from an already-migrated archive (to avoid
 * re-running the whole pipeline just to reach that state), while the
 * fingerprint must still match the original pre-migration input the
 * script will actually be invoked with.
 * @param options
 * @param options.archiveToExtract - The `.nitpicker` to untar into the work dir.
 * @param options.workDir - The work dir to populate (see {@link deriveWorkDir}).
 * @param options.fingerprintSourcePath - The path the script will be invoked
 *   with as its input argument.
 */
async function seedResumableWorkDir(options: {
	archiveToExtract: string;
	workDir: string;
	fingerprintSourcePath: string;
}): Promise<void> {
	const { archiveToExtract, workDir, fingerprintSourcePath } = options;
	mkdirSync(workDir, { recursive: true });
	await tar.x({ file: archiveToExtract, cwd: workDir });
	const stat = statSync(fingerprintSourcePath);
	writeFileSync(
		path.resolve(workDir, '.source-fingerprint.json'),
		JSON.stringify({ size: stat.size, mtimeMs: stat.mtimeMs }),
	);
	writeFileSync(path.resolve(workDir, '.untar-complete'), '');
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

				// The internal resume-checkpoint table must never ship in the
				// output — it is dropped once every DB-level step is done.
				expect(await db.schema.hasTable('_migrate_progress')).toBe(false);
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

			// The work dir is preserved on failure (only removed on full
			// success) so a resumed run can pick back up instead of
			// re-extracting and re-populating from scratch.
			expect(existsSync(deriveWorkDir(outputPath))).toBe(true);
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

	it(
		'resume: skips untar when a completed work dir already exists',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			// Build the work dir by hand exactly as a completed untar would
			// leave it, so the script's resume path is exercised without
			// ever having to actually kill a process.
			const workDir = deriveWorkDir(outputPath);
			await seedResumableWorkDir({
				archiveToExtract: inputPath,
				workDir,
				fingerprintSourcePath: inputPath,
			});

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('resuming existing work dir (skip untar)');
			// The fresh-extraction log line only appears on the non-resume path.
			expect(stdout).not.toContain('[1/3] untar ');
			expect(existsSync(outputPath)).toBe(true);
		},
	);

	it(
		'resume: wipes and re-extracts an incomplete work dir (no untar-complete marker)',
		{ timeout: 60_000 },
		() => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			// Simulate a kill mid-extraction: a work dir with a garbage inner
			// directory and an unusable `db.sqlite`, but no `.untar-complete`
			// sentinel — that marker is only ever written right after a real
			// `tar.x` call completes, so its absence must never be read as
			// "safe to resume".
			const workDir = deriveWorkDir(outputPath);
			const garbageInner = path.resolve(workDir, 'garbage-inner');
			mkdirSync(garbageInner, { recursive: true });
			writeFileSync(path.resolve(garbageInner, 'db.sqlite'), 'not a real sqlite file');

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('[1/3] untar ');
			expect(stdout).not.toContain('resuming existing work dir');
			expect(existsSync(outputPath)).toBe(true);
		},
	);

	it(
		'resume: skips ref-table populate steps already recorded in _migrate_progress',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			const workDir = deriveWorkDir(outputPath);
			await seedResumableWorkDir({
				archiveToExtract: inputPath,
				workDir,
				fingerprintSourcePath: inputPath,
			});
			const innerDirName = await peekTarTopDir(inputPath);
			const dbPath = path.resolve(workDir, innerDirName, 'db.sqlite');

			// Pre-complete the first two of the six ref-table steps exactly as
			// the script itself would (same functions, same order), then
			// record them in `_migrate_progress` — reproducing the state a
			// kill partway through "populate ref tables" would leave behind.
			const db = knex({
				client: LibsqlDialect,
				connection: { filename: dbPath },
				useNullAsDefault: true,
			});
			try {
				await db.raw('PRAGMA foreign_keys = ON');
				await migrateRefTables(db);
				await populateContentTypeRefs(db);
				await populateUrlRefs(db);
				await db.schema.createTable('_migrate_progress', (t) => {
					t.string('step').primary();
					t.string('completed_at').notNullable();
				});
				await db('_migrate_progress').insert([
					{ step: 'content_type_refs', completed_at: new Date().toISOString() },
					{ step: 'url_refs', completed_at: new Date().toISOString() },
				]);
				await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
			} finally {
				await db.destroy();
			}
			for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
				if (existsSync(sidecar)) rmSync(sidecar, { force: true });
			}

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('populate content_type_refs: already done, skipping');
			expect(stdout).toContain('populate url_refs: already done, skipping');
			// The remaining four steps were NOT pre-completed and must still run.
			expect(stdout).not.toContain('populate text_refs: already done, skipping');
			expect(stdout).not.toContain('populate json_refs: already done, skipping');
			expect(stdout).not.toContain('populate blob_refs: already done, skipping');
			expect(stdout).not.toContain('populate header_tables: already done, skipping');
			expect(stdout).toContain('verification passed');
			expect(existsSync(outputPath)).toBe(true);

			const inspectDir = path.resolve(workingDir, 'inspect-ref-resume');
			mkdirSync(inspectDir, { recursive: true });
			await tar.x({ file: outputPath, cwd: inspectDir });
			const outInnerDirName = await peekTarTopDir(outputPath);
			const outDbPath = path.resolve(inspectDir, outInnerDirName, 'db.sqlite');
			const outDb = knex({
				client: LibsqlDialect,
				connection: { filename: outDbPath },
				useNullAsDefault: true,
			});
			try {
				// Final data matches a clean single run (happy-path fixture: 2 pages).
				const contentItemsCount = await outDb('content_items').count<{ n: number }[]>({
					n: '*',
				});
				expect(Number(contentItemsCount[0]!.n)).toBe(2);
			} finally {
				await outDb.destroy();
			}
		},
	);

	it(
		'resume: a work dir past the legacy-table drop resumes without crashing',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			buildFixtureArchive(inputPath);

			// Run the script to completion normally — the output has the
			// legacy tables already gone and `_migrate_progress` already
			// dropped, same as any migrated archive.
			const firstOutputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			execFileSync('node', [migrateScript, inputPath, firstOutputPath], {
				cwd: repoRoot,
			});

			// Seed a second target's work dir directly from that already-
			// migrated archive. From the script's point of view this is
			// indistinguishable from "a run was killed right after the drop
			// step committed": `pages` etc. are gone, `.untar-complete` is
			// present, `_migrate_progress` does not exist. `ensureLegacySourceColumns`
			// unconditionally runs `ALTER TABLE pages ...` unless every legacy
			// table's presence is checked first — resuming into this exact
			// shape without that guard fails with `no such table: pages`.
			const resumeOutputPath = path.resolve(workingDir, 'input.resume.0.13.nitpicker');
			const workDir = deriveWorkDir(resumeOutputPath);
			await seedResumableWorkDir({
				archiveToExtract: firstOutputPath,
				workDir,
				fingerprintSourcePath: inputPath,
			});

			const stdout = execFileSync('node', [migrateScript, inputPath, resumeOutputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('legacy tables already dropped');
			expect(existsSync(resumeOutputPath)).toBe(true);

			const inspectDir = path.resolve(workingDir, 'inspect-post-drop-resume');
			mkdirSync(inspectDir, { recursive: true });
			await tar.x({ file: resumeOutputPath, cwd: inspectDir });
			const innerDirName = await peekTarTopDir(resumeOutputPath);
			const dbPath = path.resolve(inspectDir, innerDirName, 'db.sqlite');
			const db = knex({
				client: LibsqlDialect,
				connection: { filename: dbPath },
				useNullAsDefault: true,
			});
			try {
				const contentItemsCount = await db('content_items').count<{ n: number }[]>({
					n: '*',
				});
				expect(Number(contentItemsCount[0]!.n)).toBe(2);
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
		'resume: refuses to silently reuse a work dir extracted from a different input',
		{ timeout: 60_000 },
		async () => {
			const inputPathA = path.resolve(workingDir, 'input-a.nitpicker');
			const inputPathB = path.resolve(workingDir, 'input-b.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPathA);
			buildFixtureArchive(inputPathB);
			// Make B distinguishable from A's otherwise-identical fixture
			// data: one extra legacy page, so B's final `content_items`
			// count (3) differs from A's (2).
			await mutateFixture(inputPathB, async (db) => {
				await db('pages').insert({
					url: 'https://example.com/extra-page',
					scraped: true,
					isTarget: true,
				});
			});

			// Seed the work dir as if a prior (killed) run had already
			// extracted A — the work dir's deterministic name is derived
			// only from `outputPath`, so it is identical regardless of
			// which input produced it.
			const workDir = deriveWorkDir(outputPath);
			await seedResumableWorkDir({
				archiveToExtract: inputPathA,
				workDir,
				fingerprintSourcePath: inputPathA,
			});

			// Invoke the script with B as the input, same output path. A
			// naive "work dir + untar-complete marker exists, skip untar"
			// resume check would silently migrate A's stale data and
			// produce an output that claims to be B's migration but isn't.
			// The fingerprint mismatch must force a fresh extraction from
			// the actual input argument instead.
			const stdout = execFileSync('node', [migrateScript, inputPathB, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('does not match');
			expect(stdout).toContain('[1/3] untar ');

			const inspectDir = path.resolve(workingDir, 'inspect-fingerprint-mismatch');
			mkdirSync(inspectDir, { recursive: true });
			await tar.x({ file: outputPath, cwd: inspectDir });
			const innerDirName = await peekTarTopDir(outputPath);
			const dbPath = path.resolve(inspectDir, innerDirName, 'db.sqlite');
			const db = knex({
				client: LibsqlDialect,
				connection: { filename: dbPath },
				useNullAsDefault: true,
			});
			try {
				const contentItemsCount = await db('content_items').count<{ n: number }[]>({
					n: '*',
				});
				// 3, not 2 — proves the output was built from B (the actual
				// input argument), not from A (the work dir's stale contents).
				expect(Number(contentItemsCount[0]!.n)).toBe(3);
			} finally {
				await db.destroy();
			}
		},
	);

	it(
		'resume: a live lock on the work dir rejects a concurrent invocation',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			// Hold the lock with this test process's own (necessarily live)
			// PID instead of racing two real subprocesses — deterministic,
			// no timing window to get wrong.
			const workDir = deriveWorkDir(outputPath);
			const releaseLock = await acquireArchiveLock(workDir);
			try {
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
				expect(stderr).toMatch(/Archive is being used by another process/);
				expect(existsSync(outputPath)).toBe(false);
			} finally {
				await releaseLock();
			}
		},
	);

	it(
		'resume: skips the entity-populate + verify step already recorded in _migrate_progress',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			const workDir = deriveWorkDir(outputPath);
			await seedResumableWorkDir({
				archiveToExtract: inputPath,
				workDir,
				fingerprintSourcePath: inputPath,
			});
			const innerDirName = await peekTarTopDir(inputPath);
			const dbPath = path.resolve(workDir, innerDirName, 'db.sqlite');

			// Pre-complete ref-table populate, entity-table populate, and
			// verification exactly as the script itself would, then record
			// `entity_and_verify` as done — reproducing the state a kill
			// right after that step committed would leave behind.
			const db = knex({
				client: LibsqlDialect,
				connection: { filename: dbPath },
				useNullAsDefault: true,
			});
			try {
				await db.raw('PRAGMA foreign_keys = ON');
				await migrateRefTables(db);
				await migrateEntityTables(db);
				await populateRefTables(db);
				await populateEntityTables(db, noopDomPathResolver);
				await verifyMigration(db);
				await db.schema.createTable('_migrate_progress', (t) => {
					t.string('step').primary();
					t.string('completed_at').notNullable();
				});
				const completedAt = new Date().toISOString();
				await db('_migrate_progress').insert(
					[
						'content_type_refs',
						'url_refs',
						'text_refs',
						'json_refs',
						'blob_refs',
						'header_tables',
						'entity_and_verify',
					].map((step) => ({ step, completed_at: completedAt })),
				);
				await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
			} finally {
				await db.destroy();
			}
			for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
				if (existsSync(sidecar)) rmSync(sidecar, { force: true });
			}

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain(
				'populate entity tables + verify: already done and already verified, skipping',
			);
			// The entity-populate transaction was not re-entered, so its own
			// "verify migration invariants" line must not appear again.
			expect(stdout).not.toContain('verify migration invariants');
			expect(existsSync(outputPath)).toBe(true);
		},
	);

	it(
		'resume: skips the adjunct FK retarget step already recorded in _migrate_progress',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			const workDir = deriveWorkDir(outputPath);
			await seedResumableWorkDir({
				archiveToExtract: inputPath,
				workDir,
				fingerprintSourcePath: inputPath,
			});
			const innerDirName = await peekTarTopDir(inputPath);
			const dbPath = path.resolve(workDir, innerDirName, 'db.sqlite');

			// Pre-complete everything through retarget, exactly as the script
			// itself would, then record `retarget` as done — reproducing the
			// state a kill right after that step committed would leave behind.
			const db = knex({
				client: LibsqlDialect,
				connection: { filename: dbPath },
				useNullAsDefault: true,
			});
			try {
				await db.raw('PRAGMA foreign_keys = ON');
				await migrateRefTables(db);
				await migrateEntityTables(db);
				await populateRefTables(db);
				await populateEntityTables(db, noopDomPathResolver);
				await verifyMigration(db);
				await createAdjunctTables(db);
				await retargetLegacyFkTables(db);
				await db.schema.createTable('_migrate_progress', (t) => {
					t.string('step').primary();
					t.string('completed_at').notNullable();
				});
				const completedAt = new Date().toISOString();
				await db('_migrate_progress').insert(
					[
						'content_type_refs',
						'url_refs',
						'text_refs',
						'json_refs',
						'blob_refs',
						'header_tables',
						'entity_and_verify',
						'retarget',
					].map((step) => ({ step, completed_at: completedAt })),
				);
				await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
			} finally {
				await db.destroy();
			}
			for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
				if (existsSync(sidecar)) rmSync(sidecar, { force: true });
			}

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain(
				'retarget adjunct FKs → content_items(id): already done, skipping',
			);
			expect(existsSync(outputPath)).toBe(true);

			const inspectDir = path.resolve(workingDir, 'inspect-retarget-resume');
			mkdirSync(inspectDir, { recursive: true });
			await tar.x({ file: outputPath, cwd: inspectDir });
			const outInnerDirName = await peekTarTopDir(outputPath);
			const outDbPath = path.resolve(inspectDir, outInnerDirName, 'db.sqlite');
			const outDb = knex({
				client: LibsqlDialect,
				connection: { filename: outDbPath },
				useNullAsDefault: true,
			});
			try {
				for (const table of [
					'page_html_ref',
					'page_tags',
					'page_jsonld',
					'page_errors',
				]) {
					const parents = await fkParentTables(outDb, table);
					expect(parents.has('content_items'), `${table} → content_items`).toBe(true);
				}
			} finally {
				await outDb.destroy();
			}
		},
	);

	it(
		'resume: skips the viewer read model build when its completion marker already exists',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			buildFixtureArchive(inputPath);

			const firstOutputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			execFileSync('node', [migrateScript, inputPath, firstOutputPath], {
				cwd: repoRoot,
			});

			// `.viewer-build-complete` lives at the work dir root, a sibling
			// of the tarred inner directory — never part of the output tar —
			// so it must be recreated by hand here to simulate a kill right
			// after the viewer build committed.
			const resumeOutputPath = path.resolve(
				workingDir,
				'input.resume-viewer.0.13.nitpicker',
			);
			const workDir = deriveWorkDir(resumeOutputPath);
			await seedResumableWorkDir({
				archiveToExtract: firstOutputPath,
				workDir,
				fingerprintSourcePath: inputPath,
			});
			writeFileSync(path.resolve(workDir, '.viewer-build-complete'), '');

			const stdout = execFileSync('node', [migrateScript, inputPath, resumeOutputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('build viewer read model: already done, skipping');
			expect(existsSync(resumeOutputPath)).toBe(true);
		},
	);

	it(
		'resume: treats a partial (inconsistent) legacy-table state as gone rather than crashing',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			const workDir = deriveWorkDir(outputPath);
			await seedResumableWorkDir({
				archiveToExtract: inputPath,
				workDir,
				fingerprintSourcePath: inputPath,
			});
			const innerDirName = await peekTarTopDir(inputPath);
			const dbPath = path.resolve(workDir, innerDirName, 'db.sqlite');

			// A state `dropLegacyTables` cannot produce today (it drops all
			// five legacy tables together) but the LEGACY_TABLE_NAMES guard
			// must still handle safely: entity/ref populate already done
			// (so retarget has real `content_items` rows to point at) and
			// one legacy table gone, while `pages` — which
			// `ensureLegacySourceColumns` reads unconditionally when legacy
			// tables are considered present — is still intact.
			const db = knex({
				client: LibsqlDialect,
				connection: { filename: dbPath },
				useNullAsDefault: true,
			});
			try {
				await db.raw('PRAGMA foreign_keys = ON');
				await migrateRefTables(db);
				await migrateEntityTables(db);
				await populateRefTables(db);
				await populateEntityTables(db, noopDomPathResolver);
				await verifyMigration(db);
				await db.raw('PRAGMA foreign_keys = OFF');
				await db.schema.dropTableIfExists('resources-referrers');
				await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
			} finally {
				await db.destroy();
			}
			for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
				if (existsSync(sidecar)) rmSync(sidecar, { force: true });
			}

			// Must not crash with "no such table: pages" — the guard treats
			// any missing legacy table as "cannot safely touch legacy
			// tables" and skips straight past the legacy-dependent steps.
			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('legacy tables already dropped');
			expect(existsSync(outputPath)).toBe(true);
		},
	);

	it(
		'resume: a completed-but-not-yet-cleaned-up prior run is finalized on the next invocation',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			execFileSync('node', [migrateScript, inputPath, outputPath], { cwd: repoRoot });
			// The script deletes its own work dir on success; recreate one
			// here to simulate a kill between the output rename and that
			// final cleanup.
			const workDir = deriveWorkDir(outputPath);
			await seedResumableWorkDir({
				archiveToExtract: inputPath,
				workDir,
				fingerprintSourcePath: inputPath,
			});

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('A previous run already completed successfully');
			expect(existsSync(workDir)).toBe(false);
			expect(existsSync(outputPath)).toBe(true);
		},
	);

	it(
		'errors when the output already exists and no work dir remains to explain it',
		{ timeout: 60_000 },
		() => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);
			execFileSync('node', [migrateScript, inputPath, outputPath], { cwd: repoRoot });

			// The script already deleted its own work dir on success — this
			// reproduces re-running against an output that exists for a
			// reason the script cannot explain from its own state.
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
			expect(stderr).toContain('remove it first');
		},
	);

	it(
		'errors instead of guessing when the output exists alongside a work dir that does not match it',
		{ timeout: 60_000 },
		async () => {
			const inputPathA = path.resolve(workingDir, 'input-a.nitpicker');
			const inputPathB = path.resolve(workingDir, 'input-b.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPathA);
			buildFixtureArchive(inputPathB);

			execFileSync('node', [migrateScript, inputPathA, outputPath], { cwd: repoRoot });
			// Recreate a work dir as if an unrelated attempt against a
			// different input (B) was killed right after finishing its own
			// rename — from the script's perspective at start-up this looks
			// identical to "output exists, work dir also exists", but the
			// work dir does not actually belong to A.
			const workDir = deriveWorkDir(outputPath);
			await seedResumableWorkDir({
				archiveToExtract: inputPathB,
				workDir,
				fingerprintSourcePath: inputPathB,
			});

			let thrown: Error | null = null;
			try {
				execFileSync('node', [migrateScript, inputPathA, outputPath], {
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
			expect(stderr).toContain('does not match');
			// The pre-existing output from A must be left untouched, not
			// silently overwritten or deleted based on an unrelated work dir.
			expect(existsSync(outputPath)).toBe(true);
		},
	);

	it(
		'resume: removes a leftover .tmp output from a re-tar killed mid-write before starting',
		{ timeout: 60_000 },
		() => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			// Simulate a kill mid-re-tar: a stray `.tmp` file at the output
			// path, but no real output yet.
			writeFileSync(`${outputPath}.tmp`, 'partial tar bytes');

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('verification passed');
			expect(existsSync(outputPath)).toBe(true);
			expect(existsSync(`${outputPath}.tmp`)).toBe(false);
		},
	);

	it(
		'--skip-disk-check bypasses the startup disk-space estimate without breaking argument parsing',
		{ timeout: 60_000 },
		() => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			const stdout = execFileSync(
				'node',
				[migrateScript, inputPath, outputPath, '--skip-disk-check'],
				{ cwd: repoRoot },
			).toString();

			expect(stdout).toContain('verification passed');
			expect(existsSync(outputPath)).toBe(true);
		},
	);

	it(
		'resume: treats an unparseable fingerprint file as a mismatch and re-extracts',
		{ timeout: 60_000 },
		async () => {
			const inputPath = path.resolve(workingDir, 'input.nitpicker');
			const outputPath = path.resolve(workingDir, 'input.0.13.nitpicker');
			buildFixtureArchive(inputPath);

			const workDir = deriveWorkDir(outputPath);
			await seedResumableWorkDir({
				archiveToExtract: inputPath,
				workDir,
				fingerprintSourcePath: inputPath,
			});
			// Corrupt the fingerprint after seeding — simulates a write that
			// was itself interrupted mid-flush.
			writeFileSync(path.resolve(workDir, '.source-fingerprint.json'), '{not valid json');

			const stdout = execFileSync('node', [migrateScript, inputPath, outputPath], {
				cwd: repoRoot,
			}).toString();

			expect(stdout).toContain('does not match');
			expect(stdout).toContain('[1/3] untar ');
			expect(existsSync(outputPath)).toBe(true);
		},
	);
});
