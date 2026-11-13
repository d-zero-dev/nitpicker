import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanup } from './helpers.js';

/**
 * Builds the smallest object `cleanup()` accepts, recording the order of the
 * calls so a test can assert on it.
 * @param options - Optional errors the handles should reject with.
 * @param options.accessorError - Rejection value of `accessor.close()`.
 * @param options.archiveError - Rejection value of `archive.releaseHandle()`.
 */
async function createTarget(
	options: { accessorError?: Error; archiveError?: Error } = {},
) {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-e2e-helpers-spec-'));
	const calls: string[] = [];
	return {
		cwd,
		calls,
		accessor: {
			async close() {
				calls.push('accessor.close');
				if (options.accessorError) throw options.accessorError;
			},
		},
		archive: {
			async releaseHandle() {
				calls.push('archive.releaseHandle');
				if (options.archiveError) throw options.archiveError;
			},
		},
	};
}

async function exists(target: string) {
	return fs.stat(target).then(
		() => true,
		() => false,
	);
}

describe('cleanup', () => {
	const created: string[] = [];

	afterEach(async () => {
		await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })));
		created.length = 0;
	});

	it('アクセサと書き込みハンドルの両方を解放してから作業ディレクトリを消す', async () => {
		const target = await createTarget();
		created.push(target.cwd);

		await cleanup(target);

		expect(target.calls).toHaveLength(2);
		expect(target.calls).toContain('accessor.close');
		expect(target.calls).toContain('archive.releaseHandle');
		expect(await exists(target.cwd)).toBe(false);
	});

	it('アクセサの close が失敗しても書き込みハンドルを解放し、作業ディレクトリを消して、そのエラーを投げる', async () => {
		const error = new Error('accessor close failed');
		const target = await createTarget({ accessorError: error });
		created.push(target.cwd);

		await expect(cleanup(target)).rejects.toBe(error);

		expect(target.calls).toContain('archive.releaseHandle');
		expect(await exists(target.cwd)).toBe(false);
	});

	it('書き込みハンドルの解放が失敗しても作業ディレクトリを消して、そのエラーを投げる', async () => {
		const error = new Error('release failed');
		const target = await createTarget({ archiveError: error });
		created.push(target.cwd);

		await expect(cleanup(target)).rejects.toBe(error);

		expect(await exists(target.cwd)).toBe(false);
	});

	it('両方が失敗したときは先のエラーを隠さず、両方を AggregateError にまとめて投げる', async () => {
		const accessorError = new Error('accessor close failed');
		const archiveError = new Error('release failed');
		const target = await createTarget({ accessorError, archiveError });
		created.push(target.cwd);

		const thrown = await cleanup(target).then(
			() => {},
			(error: unknown) => error,
		);

		expect(thrown).toBeInstanceOf(AggregateError);
		expect((thrown as AggregateError).errors).toEqual([accessorError, archiveError]);
		expect(await exists(target.cwd)).toBe(false);
	});
});
