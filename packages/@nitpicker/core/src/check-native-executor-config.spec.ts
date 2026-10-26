import { describe, it, expect, vi } from 'vitest';

const check = vi.hoisted(() => vi.fn());

vi.mock('./native-binding.js', () => ({
	nativeBinding: { checkNativeExecutorConfig: check },
}));

const { checkNativeExecutorConfig } = await import('./check-native-executor-config.js');

describe('checkNativeExecutorConfig', () => {
	it('returns when the addon accepts its settings', () => {
		check.mockReturnValueOnce();
		expect(() => checkNativeExecutorConfig()).not.toThrow();
	});

	it('lets the addon’s error, which names the variable, reach the caller', () => {
		check.mockImplementationOnce(() => {
			throw new Error(
				'Invalid NITPICKER_NATIVE_THREADS="lots": expected a positive integer',
			);
		});
		expect(() => checkNativeExecutorConfig()).toThrow(
			'Invalid NITPICKER_NATIVE_THREADS="lots"',
		);
	});
});
