import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	check: vi.fn(),
	connect: vi.fn(() => Promise.resolve()),
}));

vi.mock('@nitpicker/archive/native-executor/check-native-executor-config', () => ({
	checkNativeExecutorConfig: mocks.check,
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
	StdioServerTransport: class {},
}));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
	Server: class {
		connect = mocks.connect;
		setRequestHandler = vi.fn();
	},
}));

const { startServer } = await import('./mcp-server.js');

describe('startServer', () => {
	beforeEach(() => {
		mocks.check.mockReset();
		mocks.connect.mockClear();
	});

	it('connects the transport once the native pool settings are accepted', async () => {
		await startServer();
		expect(mocks.check).toHaveBeenCalledTimes(1);
		expect(mocks.connect).toHaveBeenCalledTimes(1);
	});

	it('refuses to connect, and says which setting is wrong, when the settings are not valid', async () => {
		mocks.check.mockImplementationOnce(() => {
			throw new Error(
				'Invalid NITPICKER_NATIVE_CONCURRENCY="0": expected a positive integer',
			);
		});
		await expect(startServer()).rejects.toThrow(
			'Invalid NITPICKER_NATIVE_CONCURRENCY="0"',
		);
		expect(mocks.connect).not.toHaveBeenCalled();
	});
});
