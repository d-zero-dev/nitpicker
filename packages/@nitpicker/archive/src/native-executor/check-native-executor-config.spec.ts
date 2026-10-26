import { describe, it, expect, vi } from 'vitest';

const natively = vi.hoisted(() => vi.fn());

vi.mock('@nitpicker/core/check-native-executor-config', () => ({
	checkNativeExecutorConfig: natively,
}));

const { checkNativeExecutorConfig } = await import('./check-native-executor-config.js');

describe('checkNativeExecutorConfig', () => {
	it('asks the addon to check its settings', () => {
		checkNativeExecutorConfig();
		expect(natively).toHaveBeenCalledTimes(1);
	});

	it('lets the addon’s error reach the caller', () => {
		natively.mockImplementationOnce(() => {
			throw new Error(
				'Invalid NITPICKER_NATIVE_CONCURRENCY="0": expected a positive integer',
			);
		});
		expect(() => checkNativeExecutorConfig()).toThrow(
			'Invalid NITPICKER_NATIVE_CONCURRENCY="0"',
		);
	});
});
