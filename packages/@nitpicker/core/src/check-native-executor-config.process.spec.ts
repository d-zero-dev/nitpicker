import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

// The pool reads its settings once per process, so each case runs the built
// wrapper in a fresh one (`lib/` exists after `yarn build`, like every
// cross-package spec in this repository).
const WRAPPER = path.resolve(
	import.meta.dirname,
	'../lib/check-native-executor-config.js',
);

/**
 * Runs `checkNativeExecutorConfig` against the real addon in a new process.
 * @param settings - Variables added to the child's environment.
 * @returns What the call did: `{ ok: true }` or the error's `code` and `message`.
 */
function checkInNewProcess(settings: Record<string, string>) {
	const script = `
		const { checkNativeExecutorConfig } = await import(${JSON.stringify(WRAPPER)});
		try {
			checkNativeExecutorConfig();
			console.log(JSON.stringify({ ok: true }));
		} catch (error) {
			console.log(JSON.stringify({ ok: false, code: error.code, message: error.message }));
		}
	`;
	const { stdout, status } = spawnSync(
		process.execPath,
		['--input-type=module', '--eval', script],
		{ env: { ...process.env, ...settings }, encoding: 'utf8' },
	);
	expect(status).toBe(0);
	return JSON.parse(stdout) as { ok: boolean; code?: string; message?: string };
}

describe('checkNativeExecutorConfig against the real addon', () => {
	it('accepts the defaults', () => {
		expect(checkInNewProcess({})).toEqual({ ok: true });
	});

	it('accepts positive integers', () => {
		expect(
			checkInNewProcess({
				NITPICKER_NATIVE_THREADS: '2',
				NITPICKER_NATIVE_CONCURRENCY: '3',
			}),
		).toEqual({ ok: true });
	});

	it.each([
		['NITPICKER_NATIVE_THREADS', 'lots'],
		['NITPICKER_NATIVE_THREADS', '0'],
		['NITPICKER_NATIVE_CONCURRENCY', '-1'],
		['NITPICKER_NATIVE_CONCURRENCY', '1.5'],
	])('throws InvalidArg naming %s and its value %j', (name, value) => {
		expect(checkInNewProcess({ [name]: value })).toEqual({
			ok: false,
			code: 'InvalidArg',
			message: `Invalid ${name}="${value}": expected a positive integer`,
		});
	});
});
