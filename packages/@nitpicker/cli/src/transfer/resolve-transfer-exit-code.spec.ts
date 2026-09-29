import type { TransferOutcome } from './types.js';

import { describe, it, expect } from 'vitest';

import { ExitCode } from '../exit-code.js';

import { resolveTransferExitCode } from './resolve-transfer-exit-code.js';

const BASE: TransferOutcome = {
	outputPath: '/out/merged.nitpicker',
	fromList: false,
	appendHintRoot: 'https://example.com/',
	externalInScopeCount: 0,
	pendingCount: 0,
	pluginDataEntries: [],
	readModelError: null,
};

describe('resolveTransferExitCode', () => {
	it('returns Success when everything is clean', () => {
		expect(resolveTransferExitCode(BASE)).toBe(ExitCode.Success);
	});

	it('returns Warning when pending is non-empty', () => {
		expect(resolveTransferExitCode({ ...BASE, pendingCount: 1 })).toBe(ExitCode.Warning);
	});

	it('returns Warning when the read model build failed', () => {
		expect(resolveTransferExitCode({ ...BASE, readModelError: 'boom' })).toBe(
			ExitCode.Warning,
		);
	});

	it('external-in-scope count alone does not affect the exit code', () => {
		expect(resolveTransferExitCode({ ...BASE, externalInScopeCount: 5 })).toBe(
			ExitCode.Success,
		);
	});
});
