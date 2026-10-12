import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { extractLastJsonLine } from './extract-last-json-line.mjs';

/**
 * Runs one bench case (`scripts/bench-<bench>.mjs <archive> --case <case>
 * --json`) in its own Node process and returns the record it prints.
 *
 * A separate process per case is what makes the record's `peakRssBytes`
 * attributable: RSS only ever grows within a process, so two cases in one
 * would report the larger of the two for both. The bench's stderr
 * (progress) goes straight to this process's stderr.
 * @param {{ bench: string; archive: string; caseName: string; script?: string }} params
 *   The bench name (`body-hash` for `bench-body-hash.mjs`), the archive, the
 *   case, and `script` to run another file than `scripts/bench-<bench>.mjs`.
 * @returns {Promise<Record<string, unknown>>} The bench's record.
 * @throws {Error} When the script does not exist, the bench exits non-zero
 *   or is killed by a signal (an OOM kill shows as `SIGKILL`), or its last
 *   stdout line is not a record.
 * @example
 * const record = await runBenchProcess({
 *   bench: 'body-hash',
 *   archive: 'site.nitpicker',
 *   caseName: 'rust',
 * });
 * console.log(record.timeMs, record.peakRssBytes);
 */
export async function runBenchProcess(params) {
	const script =
		params.script ?? path.resolve(import.meta.dirname, '..', `bench-${params.bench}.mjs`);
	if (!existsSync(script)) {
		throw new Error(`No bench script ${path.basename(script)}`);
	}
	const label = `bench-${params.bench} --case ${params.caseName}`;
	const child = spawn(
		process.execPath,
		[script, params.archive, '--case', params.caseName, '--json'],
		{ stdio: ['ignore', 'pipe', 'inherit'] },
	);
	let stdout = '';
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	const { code, signal } = await new Promise((resolve, reject) => {
		child.on('error', reject);
		child.on('close', (exitCode, exitSignal) => {
			resolve({ code: exitCode, signal: exitSignal });
		});
	});
	if (signal !== null) {
		throw new Error(`${label} was killed by ${signal}`);
	}
	if (code !== 0) {
		throw new Error(`${label} exited with ${code}`);
	}
	try {
		return extractLastJsonLine(stdout);
	} catch (error) {
		throw new Error(`${label}: ${error.message}`);
	}
}
