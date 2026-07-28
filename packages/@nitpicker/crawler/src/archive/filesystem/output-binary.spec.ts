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
		// Decimals rather than hex to sidestep the local prettier vs
		// unicorn/number-literal-case conflict — prettier lowercases hex
		// letters, unicorn demands uppercase. 0=0x00, 255=0xFF, 16=0x10, 128=0x80.
		const data = Buffer.from([0, 255, 16, 128]);
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
		// Decimals rather than hex to sidestep the local prettier vs
		// unicorn/number-literal-case conflict (see the test above). 195
		// (0xC3) without a valid continuation byte would be lossily
		// replaced with U+FFFD if this went through a UTF-8 string
		// round-trip. 65=0x41 ('A'), 40=0x28 ('('), 66=0x42 ('B').
		const data = Buffer.from([65, 195, 40, 66]);
		await outputBinary(filePath, data);
		expect(readFileSync(filePath)).toStrictEqual(data);
	});
});
