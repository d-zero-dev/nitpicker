import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { zip } from '@d-zero/fs/zip';
import knex from 'knex';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { peekTarTopDir } from './filesystem/peek-tar-top-dir.js';
import { LibsqlDialect } from './libsql-dialect.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_migrate_script__');
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
const migrateScript = path.resolve(repoRoot, 'scripts', 'migrate-to-0.10.mjs');

/**
 * Builds a minimal pre-#75 `.nitpicker` archive on disk so the migration
 * script has a realistic input to operate on:
 *
 * - One row in `pages` whose `html` column points at `snapshot-html/<id>.html`
 * - A second row sharing the same body (used to assert content-addressable dedup)
 * - One row pointing at a missing snapshot entry (asserts the script logs a
 *   `[skip]` warning and proceeds rather than aborting)
 * - The bodies packaged into `snapshot-html.zip` inside the tar
 *
 * Returns the absolute path to the archive file.
 * @param filePath - Where to write the resulting `.nitpicker`.
 * @param bodyA - HTML body shared between two pages (asserts within-archive dedup).
 * @param bodyB - HTML body for a third page (asserts independent storage).
 */
async function buildLegacyArchive(
	filePath: string,
	bodyA: string,
	bodyB: string,
): Promise<void> {
	const stagingDir = path.resolve(workingDir, 'staging');
	const archiveBase = path.basename(filePath, path.extname(filePath));
	const archiveDir = path.resolve(stagingDir, archiveBase);
	const snapshotDir = path.resolve(archiveDir, 'snapshot-html');
	mkdirSync(snapshotDir, { recursive: true });

	const dbPath = path.resolve(archiveDir, 'db.sqlite');
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: dbPath },
		useNullAsDefault: true,
	});
	try {
		await db.raw('PRAGMA journal_mode = WAL');
		// Hand-roll the legacy schema. The migration script only reads
		// `id` and `html` from `pages` so a stripped-down shape suffices.
		await db.raw(`
			CREATE TABLE info (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				version TEXT,
				name TEXT,
				baseUrl TEXT,
				roots TEXT,
				recursive INTEGER,
				interval INTEGER,
				image INTEGER,
				fetchExternal INTEGER,
				parallels INTEGER,
				excludes TEXT,
				excludeKeywords TEXT,
				excludeUrls TEXT,
				maxExcludedDepth INTEGER,
				retry INTEGER,
				fromList INTEGER,
				disableQueries INTEGER,
				userAgent TEXT,
				ignoreRobots INTEGER
			)
		`);
		await db.raw(`
			CREATE TABLE pages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				url TEXT NOT NULL UNIQUE,
				redirectDestId INTEGER,
				scraped INTEGER NOT NULL,
				isTarget INTEGER NOT NULL,
				isExternal INTEGER,
				status INTEGER,
				statusText TEXT,
				contentType TEXT,
				contentLength INTEGER,
				responseHeaders TEXT,
				lang TEXT,
				title TEXT,
				description TEXT,
				keywords TEXT,
				noindex INTEGER,
				nofollow INTEGER,
				noarchive INTEGER,
				canonical TEXT,
				alternate TEXT,
				og_type TEXT,
				og_title TEXT,
				og_site_name TEXT,
				og_description TEXT,
				og_url TEXT,
				og_image TEXT,
				twitter_card TEXT,
				html TEXT,
				isSkipped INTEGER,
				skipReason TEXT,
				"order" INTEGER
			)
		`);
		await db.raw(
			`INSERT INTO info(version, name, baseUrl, roots) VALUES ('0.0.0', 'fixture', 'http://example.com/', '[]')`,
		);
		await db('pages').insert([
			{
				url: 'http://example.com/a',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: 200,
				contentType: 'text/html',
				html: 'snapshot-html/1.html',
				isSkipped: 0,
			},
			{
				url: 'http://example.com/b',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: 200,
				contentType: 'text/html',
				html: 'snapshot-html/2.html',
				isSkipped: 0,
			},
			{
				url: 'http://example.com/c',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: 200,
				contentType: 'text/html',
				html: 'snapshot-html/3.html',
				isSkipped: 0,
			},
			{
				url: 'http://example.com/dangling',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
				status: 200,
				contentType: 'text/html',
				html: 'snapshot-html/missing.html',
				isSkipped: 0,
			},
		]);
		// Keep the legacy fixture deterministic: flush WAL contents into the
		// main db.sqlite before teardown so the subsequent tar step never races
		// libsql's asynchronous sidecar cleanup.
		await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
	} finally {
		await db.destroy();
	}

	for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
		if (existsSync(sidecar)) {
			rmSync(sidecar, { force: true });
		}
	}

	// Write bodies. Pages 1 and 2 share a body so dedup is observable;
	// page 3 has its own body; the "dangling" row deliberately has NO
	// matching file in the zip (the migration must log and skip it).
	const { writeFileSync } = await import('node:fs');
	writeFileSync(path.resolve(snapshotDir, '1.html'), bodyA);
	writeFileSync(path.resolve(snapshotDir, '2.html'), bodyA);
	writeFileSync(path.resolve(snapshotDir, '3.html'), bodyB);

	// Zip the snapshot dir into `snapshot-html.zip`, the legacy layout.
	await zip(path.resolve(archiveDir, 'snapshot-html.zip'), snapshotDir);
	rmSync(snapshotDir, { recursive: true, force: true });

	// Tar the archive directory into the final `.nitpicker`.
	await tar.c({ file: filePath, cwd: stagingDir, portable: true }, [archiveBase]);

	rmSync(stagingDir, { recursive: true, force: true });
}

/**
 * Integration smoke test for `scripts/migrate-to-0.10.mjs`. The script is
 * a multi-hour CPU-bound one-shot, so a full end-to-end fidelity test
 * against 100k+ pages is impractical for CI. This spec pins the user-
 * visible contract: round-trip a tiny pre-0.10 archive through the script
 * and confirm the migrated output is readable by the post-0.10 Archive
 * API, that within-archive body dedup fires, and that missing snapshot
 * entries do not abort the run.
 */
describe('scripts/migrate-to-0.10.mjs (integration)', () => {
	beforeEach(() => {
		mkdirSync(workingDir, { recursive: true });
	});
	afterEach(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it(
		'Round-trips a pre-0.10 archive: bodies are readable, identical bodies dedup, missing entries skipped',
		{ timeout: 30_000 },
		async () => {
			const legacyPath = path.resolve(workingDir, 'legacy.nitpicker');
			const migratedPath = path.resolve(workingDir, 'legacy.0.10.nitpicker');
			const bodyA = '<html><body>shared body</body></html>';
			const bodyB = '<html><body>distinct body</body></html>';

			await buildLegacyArchive(legacyPath, bodyA, bodyB);

			execFileSync('node', [migrateScript, legacyPath, migratedPath], {
				cwd: repoRoot,
				stdio: 'pipe',
			});

			expect(existsSync(migratedPath)).toBe(true);

			// Inspect the migrated tar's inner db.sqlite directly (skipping
			// Archive.open) so a regression in the read path doesn't mask a
			// migration data-loss bug.
			const inspectDir = path.resolve(workingDir, 'inspect');
			mkdirSync(inspectDir, { recursive: true });
			await tar.x({ file: migratedPath, cwd: inspectDir });
			// Peek the tar's actual inner-dir name — the migrate script
			// preserves the legacy archive's `legacy/` name regardless of
			// the output basename (`legacy.0.10`).
			const innerDirName = await peekTarTopDir(migratedPath);
			const innerDbPath = path.resolve(inspectDir, innerDirName, 'db.sqlite');
			expect(existsSync(innerDbPath)).toBe(true);

			const inspectKnex = knex({
				client: LibsqlDialect,
				connection: { filename: innerDbPath },
				useNullAsDefault: true,
			});
			try {
				const blobCount = await inspectKnex('page_html_blobs')
					.count<{ n: number }[]>('* as n')
					.first();
				const refCount = await inspectKnex('page_html_ref')
					.count<{ n: number }[]>('* as n')
					.first();
				expect(Number(blobCount?.n ?? 0)).toBe(2); // bodyA + bodyB
				expect(Number(refCount?.n ?? 0)).toBe(3); // a, b, c (dangling skipped)
			} finally {
				await inspectKnex.destroy();
			}

			// The migrate-to-0.10 output is at info.version = 0.10.0 which
			// is below REQUIRED_FORMAT_VERSION (see
			// `assertCompatibleVersion`). Opening it via `Archive.open`
			// here is out of scope for this spec: the chained migration
			// path is exercised end-to-end in `migrate-to-0.13-script.spec.ts`
			// which runs `migrate-to-0.13.mjs` on its own fixture and
			// asserts the resulting archive is openable. Doing it here in
			// addition would run jsdom-heavy entity populate twice per CI job with
			// nothing new to prove.
			//
			// The inspection above (raw SQLite `page_html_blobs` /
			// `page_html_ref` row counts) already pins the migrate-to-0.10
			// contract on its own, without needing `Archive.open`.
		},
	);

	it(
		'Refuses to run a second time when page_html_ref already has rows',
		{ timeout: 30_000 },
		async () => {
			const legacyPath = path.resolve(workingDir, 'legacy.nitpicker');
			const migratedPath = path.resolve(workingDir, 'legacy.migrated.nitpicker');
			await buildLegacyArchive(legacyPath, '<p>a</p>', '<p>b</p>');

			const stdout = execFileSync('node', [migrateScript, legacyPath, migratedPath], {
				cwd: repoRoot,
			});
			// Debug aid: surfaces the migrator's per-chunk progress if the
			// round-trip assertion below fails (otherwise vitest swallows it).
			expect(stdout.toString()).toContain('Done.');

			const reRunOutput = path.resolve(workingDir, 'legacy.re-run.nitpicker');
			expect(() =>
				execFileSync('node', [migrateScript, migratedPath, reRunOutput], {
					cwd: repoRoot,
					stdio: 'pipe',
				}),
			).toThrow();
			// Output file from the failed re-run is cleaned up so the
			// next invocation sees a clean slate.
			expect(existsSync(reRunOutput)).toBe(false);
		},
	);

	it(
		'Step B reshapes the pages table to the 0.10 schema and bumps info.version',
		{ timeout: 30_000 },
		async () => {
			// Asserts the schema-level contract of Step B (meta schema
			// upgrade) on the migrated `db.sqlite`. The pre-0.10 fixture
			// builder seeds the legacy noindex/alternate columns and lacks
			// meta_extras / page_tags / page_jsonld — exactly the inputs
			// Step B is designed to fix. We inspect the inner db.sqlite
			// directly rather than opening with Archive.open to keep the
			// assertion targeted at migration output (orthogonal to read-
			// path regressions).
			const legacyPath = path.resolve(workingDir, 'step-b.nitpicker');
			const migratedPath = path.resolve(workingDir, 'step-b.0.10.nitpicker');
			await buildLegacyArchive(legacyPath, '<p>a</p>', '<p>b</p>');

			execFileSync('node', [migrateScript, legacyPath, migratedPath], {
				cwd: repoRoot,
				stdio: 'pipe',
			});

			const inspectDir = path.resolve(workingDir, 'step-b-inspect');
			mkdirSync(inspectDir, { recursive: true });
			await tar.x({ file: migratedPath, cwd: inspectDir });
			// Use the tar's actual top-dir name — the migrate script
			// preserves the legacy archive's inner-dir name regardless of
			// the output basename.
			const innerDirName = await peekTarTopDir(migratedPath);
			const innerDbPath = path.resolve(inspectDir, innerDirName, 'db.sqlite');

			const inspectKnex = knex({
				client: LibsqlDialect,
				connection: { filename: innerDbPath },
				useNullAsDefault: true,
			});
			try {
				const columns: { name: string }[] = await inspectKnex.raw(
					"PRAGMA table_info('pages')",
				);
				const columnNames = new Set(columns.map((c) => c.name));

				// New 0.10 columns must be present.
				expect(columnNames.has('meta_extras')).toBe(true);
				expect(columnNames.has('robots_raw')).toBe(true);
				expect(columnNames.has('tag_count')).toBe(true);
				expect(columnNames.has('jsonld_count')).toBe(true);

				// Legacy column renames must have taken effect.
				expect(columnNames.has('robots_noindex')).toBe(true);
				expect(columnNames.has('robots_nofollow')).toBe(true);
				expect(columnNames.has('robots_noarchive')).toBe(true);
				expect(columnNames.has('noindex')).toBe(false);
				expect(columnNames.has('nofollow')).toBe(false);
				expect(columnNames.has('noarchive')).toBe(false);

				// `alternate` was dropped in 0.10.
				expect(columnNames.has('alternate')).toBe(false);

				// New empty tables must exist.
				const tagsTable = await inspectKnex.schema.hasTable('page_tags');
				const jsonldTable = await inspectKnex.schema.hasTable('page_jsonld');
				expect(tagsTable).toBe(true);
				expect(jsonldTable).toBe(true);

				// info.version was bumped — the post-migration archive must
				// satisfy assertCompatibleVersion's `>= 0.10.0` check.
				const infoRow: { version: string } | undefined = await inspectKnex
					.from('info')
					.select('version')
					.first();
				expect(infoRow?.version).toBe('0.10.0');
			} finally {
				await inspectKnex.destroy();
			}
		},
	);

	it(
		'Step C backfills flat meta columns, meta_extras, and page_jsonld from HTML BLOB',
		{ timeout: 60_000 },
		async () => {
			// Asserts that Step C's HTML → jsdom → extractMetaFromDocument
			// pipeline actually populates the 0.10 columns it shapes in
			// Step B. The fixture HTML carries lang, OG, robots, and an
			// embedded JSON-LD entry; after migration the inspected db
			// should reflect each.
			const legacyPath = path.resolve(workingDir, 'step-c.nitpicker');
			const migratedPath = path.resolve(workingDir, 'step-c.0.10.nitpicker');
			const richHtml = `<!DOCTYPE html>
<html lang="ja-JP">
<head>
<meta charset="utf-8">
<title>Sample Page</title>
<meta name="description" content="Sample description for Step C">
<meta name="robots" content="noindex, nofollow">
<meta property="og:title" content="OG Title">
<meta property="og:type" content="article">
<meta property="og:url" content="http://example.com/a">
<link rel="canonical" href="http://example.com/a">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Test"}</script>
</head>
<body><h1>Sample</h1></body>
</html>`;
			const plainHtml = '<html><body>plain</body></html>';

			await buildLegacyArchive(legacyPath, richHtml, plainHtml);

			execFileSync('node', [migrateScript, legacyPath, migratedPath], {
				cwd: repoRoot,
				stdio: 'pipe',
			});

			const inspectDir = path.resolve(workingDir, 'step-c-inspect');
			mkdirSync(inspectDir, { recursive: true });
			await tar.x({ file: migratedPath, cwd: inspectDir });
			const innerDirName = await peekTarTopDir(migratedPath);
			const innerDbPath = path.resolve(inspectDir, innerDirName, 'db.sqlite');

			const inspectKnex = knex({
				client: LibsqlDialect,
				connection: { filename: innerDbPath },
				useNullAsDefault: true,
			});
			try {
				type PageRow = {
					url: string;
					lang: string | null;
					title: string | null;
					og_title: string | null;
					og_type: string | null;
					og_url: string | null;
					canonical: string | null;
					robots_noindex: number | null;
					robots_nofollow: number | null;
					meta_extras: string | null;
					jsonld_count: number | null;
				};
				const rich: PageRow | undefined = await inspectKnex
					.from<PageRow>('pages')
					.where('url', 'http://example.com/a')
					.first();
				expect(rich?.lang).toBe('ja-JP');
				expect(rich?.title).toBe('Sample Page');
				expect(rich?.og_title).toBe('OG Title');
				expect(rich?.og_type).toBe('article');
				expect(rich?.canonical).toBe('http://example.com/a');
				expect(rich?.robots_noindex).toBe(1);
				expect(rich?.robots_nofollow).toBe(1);
				expect(rich?.jsonld_count).toBe(1);
				expect(typeof rich?.meta_extras).toBe('string');
				const extras = JSON.parse(rich?.meta_extras ?? '{}');
				expect(extras.og?.title).toBe('OG Title');

				// JSON-LD row landed in page_jsonld with the expected @type.
				const jsonldRows: { type: string | null; kind: string }[] = await inspectKnex
					.from('page_jsonld')
					.join('pages', 'pages.id', '=', 'page_jsonld.pageId')
					.where('pages.url', 'http://example.com/a')
					.select('page_jsonld.type as type', 'page_jsonld.kind as kind');
				expect(jsonldRows).toHaveLength(1);
				expect(jsonldRows[0]?.type).toBe('Article');
				expect(jsonldRows[0]?.kind).toBe('ld+json');

				// Plain body has no meta beyond what jsdom infers as defaults.
				// `title` defaults to empty string after jsdom serialisation;
				// deriveFlatFromMeta normalises empty → null. The fixture
				// uses `plainHtml` for the /c page (bodies /a and /b share
				// richHtml for dedup observability in the round-trip test).
				const plain: PageRow | undefined = await inspectKnex
					.from<PageRow>('pages')
					.where('url', 'http://example.com/c')
					.first();
				expect(plain?.og_title).toBeNull();
				expect(plain?.canonical).toBeNull();
			} finally {
				await inspectKnex.destroy();
			}
		},
	);
});
