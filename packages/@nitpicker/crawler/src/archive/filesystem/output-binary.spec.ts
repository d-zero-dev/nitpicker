import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { outputBinary } from './output-binary.js';

describe('outputBinary', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-output-binary');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('writes bytes to file verbatim', async () => {
		const filePath = path.join(testDir, 'file.bin');
		const data = Buffer.from([0x00, 0xff, 0x10, 0x80]);
		await outputBinary(filePath, data);
		expect(readFileSync(filePath)).toStrictEqual(data);
	});

	it('creates parent directories if needed', async () => {
		const filePath = path.join(testDir, 'sub', 'file.bin');
		const data = Buffer.from('nested', 'utf8');
		await outputBinary(filePath, data);
		expect(readFileSync(filePath)).toStrictEqual(data);
	});

	it('does not corrupt bytes that are not valid UTF-8', async () => {
		const filePath = path.join(testDir, 'invalid-utf8.bin');
		// 0xC3 without a valid continuation byte would be lossily replaced
		// with U+FFFD if this went through a UTF-8 string round-trip.
		const data = Buffer.from([0x41, 0xc3, 0x28, 0x42]);
		await outputBinary(filePath, data);
		expect(readFileSync(filePath)).toStrictEqual(data);
	});
});
