import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { reportBenchResult } from './report-bench-result.mjs';

describe('reportBenchResult', () => {
	let root;
	let archivePath;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'report-bench-result-spec-'));
		archivePath = path.join(root, 'site.nitpicker');
		await writeFile(archivePath, Buffer.alloc(1234));
		vi.spyOn(process, 'resourceUsage').mockReturnValue({ maxRSS: 120_000 });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	});

	const params = () => ({
		bench: 'tech-signals',
		caseName: 'default',
		archivePath,
		pageCount: 2,
		timeMs: 0.4444,
		metrics: { snapshots: 2, shape: { a: 1 } },
	});

	it('prints the record as one JSON line with the archive size and the peak RSS in bytes, but not the path', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		await reportBenchResult({ ...params(), json: true });
		expect(write).toHaveBeenCalledOnce();
		const line = write.mock.calls[0][0];
		expect(line.endsWith('\n')).toBe(true);
		expect(JSON.parse(line)).toEqual({
			bench: 'tech-signals',
			case: 'default',
			input: { pages: 2, archiveBytes: 1234 },
			env: { node: process.version, platform: process.platform, arch: process.arch },
			timeMs: 0.444,
			peakRssBytes: 122_880_000,
			metrics: { snapshots: 2, shape: { a: 1 } },
		});
		expect(line).not.toContain('site.nitpicker');
	});

	it('prints a human summary without --json', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await reportBenchResult({ ...params(), json: false });
		expect(log.mock.calls.map(([message]) => message)).toEqual([
			'tech-signals / default: 0.444 ms',
			'  input: 2 pages, 1234 bytes',
			'  peak RSS: 122880000 bytes',
			'  snapshots: 2',
			'  shape: {"a":1}',
		]);
	});
});
