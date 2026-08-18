import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { peekTarTopDir } from './peek-tar-top-dir.js';
import { tar } from './tar.js';

// Isolated from peek-tar-top-dir.spec.ts (issue #294): this file's whole
// purpose is mocking node:fs/promises' `open` to sum bytesRead across every
// read() call, which would otherwise leak into that file's real-filesystem
// fixture helpers (mkdir/writeFile/rm/rename/stat all go through the same
// module). ESM module namespaces aren't spy-configurable (`vi.spyOn` throws
// "Module namespace is not configurable"), so `vi.mock`'s hoisted factory is
// required instead of a plain spy. Vitest hoists this above the imports
// above, so `peekTarTopDir`'s internal `open` call resolves to the mock.
let totalBytesRead = 0;

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...actual,
		open: async (...args: Parameters<typeof actual.open>) => {
			const handle = await actual.open(...args);
			const originalRead = handle.read.bind(handle);
			handle.read = (async (...readArgs: Parameters<typeof handle.read>) => {
				const result = await originalRead(...readArgs);
				totalBytesRead += result.bytesRead;
				return result;
			}) as typeof handle.read;
			return handle;
		},
	};
});

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_peek_tar_top_dir_byte_budget__',
);

const created: string[] = [];

afterEach(async () => {
	totalBytesRead = 0;
	while (created.length > 0) {
		await fs.rm(created.pop()!, { recursive: true, force: true });
	}
});

describe('peekTarTopDir — byte budget (issue #294)', () => {
	it('reads only a small prefix of a large archive, not the whole file', async () => {
		// Builds a tar whose single entry is a multi-megabyte file, so the
		// previous list()-based implementation (reads the archive to
		// completion regardless of match position) would have to consume
		// megabytes before returning. The fast path must stop at the first
		// directory header, well under 1 KB in.
		await fs.mkdir(workingDir, { recursive: true });
		const sourceDir = path.resolve(workingDir, 'large-archive');
		await fs.mkdir(sourceDir, { recursive: true });
		await fs.writeFile(path.resolve(sourceDir, 'db.sqlite'), 'x'.repeat(5_000_000));
		const tarPath = path.resolve(workingDir, 'large-archive.nitpicker');
		await tar(sourceDir, tarPath);
		await fs.rm(sourceDir, { recursive: true, force: true });
		created.push(tarPath);

		const { size: tarSize } = await fs.stat(tarPath);
		expect(tarSize).toBeGreaterThan(5_000_000);

		expect(await peekTarTopDir(tarPath)).toBe('large-archive');
		expect(totalBytesRead).toBeLessThan(10_000);
	});
});
