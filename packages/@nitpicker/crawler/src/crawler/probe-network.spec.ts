import { lookup } from 'node:dns';

import { describe, it, expect, vi } from 'vitest';

import { probeNetwork } from './probe-network.js';

vi.mock('node:dns', () => ({
	lookup: vi.fn(),
}));

describe('probeNetwork', () => {
	it('resolves true when dns.lookup succeeds', async () => {
		vi.mocked(lookup).mockImplementation(((
			_host: string,
			callback: (error: Error | null) => void,
		) => {
			callback(null);
		}) as typeof lookup);

		await expect(probeNetwork('example.com')).resolves.toBe(true);
	});

	it('resolves false (never rejects) when dns.lookup errors', async () => {
		vi.mocked(lookup).mockImplementation(((
			_host: string,
			callback: (error: Error | null) => void,
		) => {
			callback(new Error('getaddrinfo ENOTFOUND example.com'));
		}) as typeof lookup);

		await expect(probeNetwork('example.com')).resolves.toBe(false);
	});

	it('passes the given host through to dns.lookup', async () => {
		vi.mocked(lookup).mockImplementation(((
			_host: string,
			callback: (error: Error | null) => void,
		) => {
			callback(null);
		}) as typeof lookup);

		await probeNetwork('a.example.test');
		expect(vi.mocked(lookup)).toHaveBeenCalledWith(
			'a.example.test',
			expect.any(Function),
		);
	});
});
