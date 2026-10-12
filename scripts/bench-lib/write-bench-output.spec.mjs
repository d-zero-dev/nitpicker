import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { writeBenchOutput } from './write-bench-output.mjs';

describe('writeBenchOutput', () => {
	let root;

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('creates the directory and names the file after the stem and a path-safe timestamp', async () => {
		root = await mkdtemp(path.join(tmpdir(), 'bench-output-spec-'));
		const directory = path.join(root, 'bench-output');
		const file = await writeBenchOutput({
			name: 'body-hash-rust',
			data: { timeMs: 1.5 },
			directory,
			now: new Date('2026-10-11T01:02:03.456Z'),
		});
		expect(file).toBe(
			path.join(directory, 'body-hash-rust-2026-10-11T01-02-03-456Z.json'),
		);
		expect(await readFile(file, 'utf8')).toBe('{\n\t"timeMs": 1.5\n}\n');
	});
});
