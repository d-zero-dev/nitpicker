import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, 'viewer-read-model-golden.mjs');

/** The committed 2-page archive the e2e tests also use. */
const FIXTURE = path.resolve(
	import.meta.dirname,
	'../packages/test-server/src/__tests__/e2e/fixtures/report-query-fixture.nitpicker',
);

/**
 * @param {string[]} args - Arguments for the golden script.
 * @returns {{ status: number | null, stdout: string, stderr: string }} The finished process.
 */
function runGolden(args) {
	return spawnSync(process.execPath, [SCRIPT, ...args], {
		encoding: 'utf8',
		timeout: 120_000,
	});
}

describe('viewer-read-model-golden.mjs', () => {
	let workDir;
	let goldenPath;

	beforeAll(() => {
		workDir = mkdtempSync(path.join(tmpdir(), 'nitpicker-golden-spec-'));
		goldenPath = path.join(workDir, 'golden.jsonl');
	});

	afterAll(() => {
		rmSync(workDir, { recursive: true, force: true });
	});

	it('dumps every viewer_* table as [table, key, value] lines and exits 0', () => {
		const result = runGolden(['dump', FIXTURE, goldenPath]);
		expect(result.status, result.stderr).toBe(0);
		const entries = readFileSync(goldenPath, 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		const tables = new Set(entries.map(([table]) => table));
		expect(tables.has('viewer_pages')).toBe(true);
		expect(tables.has('viewer_graph_edges')).toBe(true);
		expect(tables.has('viewer_read_model_meta')).toBe(true);
		expect([...tables].every((table) => table.startsWith('viewer_'))).toBe(true);
		// Row counts are exact; the digests are 64 hex characters.
		expect(entries).toContainEqual(['viewer_pages', 'rows', '2']);
		const digests = entries.filter(([, key]) => key.startsWith('chunk:'));
		expect(digests.length).toBeGreaterThan(0);
		expect(digests.every((entry) => /^[0-9a-f]{64}$/.test(entry[2]))).toBe(true);
	});

	it('leaves no .partial file behind after a successful dump', () => {
		expect(readdirSync(workDir).filter((name) => name.endsWith('.partial'))).toEqual([]);
	});

	it('exits 2 and leaves no golden or partial file when the dump cannot be written', () => {
		const unwritable = path.join(workDir, 'no-such-directory', 'golden.jsonl');
		const result = runGolden(['dump', FIXTURE, unwritable]);
		expect(result.status).toBe(2);
		expect(existsSync(unwritable)).toBe(false);
		expect(existsSync(`${unwritable}.partial`)).toBe(false);
	});

	it('finds no difference between a dump and a fresh build of the same archive (exit 0)', () => {
		const result = runGolden(['check', FIXTURE, goldenPath]);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toMatch(/tables match the golden/);
	});

	it('exits 1 and names the table and row range, not the row content, when a digest differs', () => {
		const tamperedPath = path.join(workDir, 'tampered.jsonl');
		const lines = readFileSync(goldenPath, 'utf8').trim().split('\n');
		const tampered = lines.map((line) => {
			const [table, key] = JSON.parse(line);
			return table === 'viewer_pages' && key === 'chunk:0'
				? JSON.stringify([table, key, '0'.repeat(64)])
				: line;
		});
		writeFileSync(tamperedPath, `${tampered.join('\n')}\n`);
		const result = runGolden(['check', FIXTURE, tamperedPath]);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/viewer_pages: rows 2 expected, 2 actual, 1 differing/);
		expect(result.stdout).toMatch(/chunk:0/);
		// The crawled URLs of the fixture never appear in what `check` prints.
		expect(result.stdout).not.toMatch(/https?:\/\//);
	});

	it('exits 1 when a table is missing from the golden', () => {
		const withoutPath = path.join(workDir, 'without-pages.jsonl');
		const lines = readFileSync(goldenPath, 'utf8')
			.trim()
			.split('\n')
			.filter((line) => JSON.parse(line)[0] !== 'viewer_pages');
		writeFileSync(withoutPath, `${lines.join('\n')}\n`);
		const result = runGolden(['check', FIXTURE, withoutPath]);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/viewer_pages: rows \(missing\) expected, 2 actual/);
	});

	it('exits 2 when the golden file cannot be read, so a crash is never mistaken for a difference', () => {
		const result = runGolden([
			'check',
			FIXTURE,
			path.join(workDir, 'does-not-exist.jsonl'),
		]);
		expect(result.status).toBe(2);
	});

	it('exits 2 for a golden that is not a [table, key, value] dump', () => {
		const badPath = path.join(workDir, 'bad.jsonl');
		writeFileSync(badPath, '{"not":"a dump line"}\n');
		const result = runGolden(['check', FIXTURE, badPath]);
		expect(result.status).toBe(2);
	});

	it('exits 2 with a usage message for a missing mode or path', () => {
		const result = runGolden(['dump', FIXTURE]);
		expect(result.status).toBe(2);
		expect(result.stderr).toMatch(/Usage:/);
	});
});
