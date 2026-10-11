import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runBenchProcess } from './run-bench-process.mjs';

describe('runBenchProcess', () => {
	let root;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'run-bench-process-spec-'));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	/**
	 * @param {string} body - The stand-in bench's source.
	 * @returns {Promise<string>} Its path.
	 */
	async function standIn(body) {
		const script = path.join(root, 'bench-stand-in.mjs');
		await writeFile(script, body);
		return script;
	}

	it('passes the archive, case and --json through and returns the last stdout line', async () => {
		const script = await standIn(
			[
				"console.log('noise before the record');",
				'console.log(JSON.stringify({ bench: "stand-in", argv: process.argv.slice(2) }));',
			].join('\n'),
		);
		expect(
			await runBenchProcess({
				bench: 'stand-in',
				archive: 'site.nitpicker',
				caseName: 'default',
				script,
			}),
		).toEqual({
			bench: 'stand-in',
			argv: ['site.nitpicker', '--case', 'default', '--json'],
		});
	});

	it('rejects when the bench exits non-zero', async () => {
		const script = await standIn('process.exit(3);');
		await expect(
			runBenchProcess({ bench: 'stand-in', archive: 'x', caseName: 'default', script }),
		).rejects.toThrow('bench-stand-in --case default exited with 3');
	});

	it('names the signal when the bench is killed', async () => {
		const script = await standIn("process.kill(process.pid, 'SIGTERM');");
		await expect(
			runBenchProcess({ bench: 'stand-in', archive: 'x', caseName: 'default', script }),
		).rejects.toThrow('bench-stand-in --case default was killed by SIGTERM');
	});

	it('rejects when the bench prints no record', async () => {
		const script = await standIn("console.log('done');");
		await expect(
			runBenchProcess({ bench: 'stand-in', archive: 'x', caseName: 'default', script }),
		).rejects.toThrow('bench-stand-in --case default: the last stdout line is not JSON');
	});

	it('rejects an unknown bench name', async () => {
		await expect(
			runBenchProcess({ bench: 'no-such-bench', archive: 'x', caseName: 'default' }),
		).rejects.toThrow('No bench script bench-no-such-bench.mjs');
	});
});
