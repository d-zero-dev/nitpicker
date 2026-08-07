import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/** Absolute path to the built CLI entry point. */
const CLI_BIN = path.resolve(
	import.meta.dirname,
	'../../../../@nitpicker/cli/bin/nitpicker.js',
);

/** Absolute path to the CLI package's package.json. */
const CLI_PKG_JSON = path.resolve(
	import.meta.dirname,
	'../../../../@nitpicker/cli/package.json',
);

/** Hard cap for CLI invocations that should complete near-instantly. */
const CLI_INVOCATION_TIMEOUT = 10_000;

/**
 * Spawn the CLI with the given argv and resolve with `{ stdout, stderr, code }`.
 * @param args - Arguments to pass after the CLI binary.
 */
async function runCli(args: readonly string[]): Promise<{
	stdout: string;
	stderr: string;
	code: number | null;
}> {
	return await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [CLI_BIN, ...args], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(
				new Error(
					`CLI did not exit within ${CLI_INVOCATION_TIMEOUT}ms for args=${JSON.stringify(args)}`,
				),
			);
		}, CLI_INVOCATION_TIMEOUT);
		child.once('exit', (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, code });
		});
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

describe('CLI version flag', () => {
	// version は CLI 本体の `import pkg from '../package.json'` と同じファイルから読む。
	// 「CLI は自身のパッケージ version を出力する」という不変条件のテストであり、
	// 観点 4 の compute_expected ルール緩和ケース（テストデータ）に該当する。
	let pkgVersion: string;

	beforeAll(async () => {
		const pkg = JSON.parse(await fs.readFile(CLI_PKG_JSON, 'utf8')) as {
			version: string;
		};
		pkgVersion = pkg.version;
	});

	it('-v でパッケージのバージョンを出力して exit 0', async () => {
		const { stdout, code } = await runCli(['-v']);
		expect(stdout).toBe(`${pkgVersion}\n`);
		expect(code).toBe(0);
	});

	it('--version でパッケージのバージョンを出力して exit 0', async () => {
		const { stdout, code } = await runCli(['--version']);
		expect(stdout).toBe(`${pkgVersion}\n`);
		expect(code).toBe(0);
	});

	it('引数なしで実行するとヘルプを stderr に出して exit 1', async () => {
		const { stdout, stderr, code } = await runCli([]);
		expect(stdout).toBe('');
		expect(stderr).toContain('Usage: npx @nitpicker/cli <command>');
		expect(code).toBe(1);
	});

	it('--help はコマンド一覧を stdout に出して exit 0', async () => {
		const { stdout, code } = await runCli(['--help']);
		expect(stdout).toContain('Usage: npx @nitpicker/cli <command>');
		expect(stdout).toContain('Commands:');
		expect(code).toBe(0);
	});

	it('crawl --help はサブコマンドのヘルプを出して exit 0（version は混入しない）', async () => {
		const { stdout, code } = await runCli(['crawl', '--help']);
		expect(stdout).toContain('Usage: npx @nitpicker/cli crawl');
		expect(stdout).not.toContain(pkgVersion);
		expect(code).toBe(0);
	});
});
