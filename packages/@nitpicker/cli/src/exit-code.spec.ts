import { describe, it, expect } from 'vitest';

import { ExitCode } from './exit-code.js';

describe('ExitCode', () => {
	it('Success is 0', () => {
		expect(ExitCode.Success).toBe(0);
	});

	it('Fatal is 1', () => {
		expect(ExitCode.Fatal).toBe(1);
	});

	it('Warning is 2', () => {
		expect(ExitCode.Warning).toBe(2);
	});
});
