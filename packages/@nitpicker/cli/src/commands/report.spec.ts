import { report as runReport } from '@nitpicker/report-google-sheets';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { verbosely as verboselyFn } from '../report/debug.js';

import { report } from './report.js';

vi.mock('@nitpicker/report-google-sheets', () => ({
	report: vi.fn(),
}));

vi.mock('../report/debug.js', () => ({
	verbosely: vi.fn(),
}));

describe('report command', () => {
	let originalIsTTY: boolean | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		originalIsTTY = process.stdout.isTTY;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(process.stdout, 'isTTY', {
			value: originalIsTTY,
			writable: true,
		});
	});

	it('passes all=true when --all flag is set', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			limit: 100_000,
			all: true,
			verbose: undefined,
			silent: undefined,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				all: true,
			}),
		);
	});

	it('passes all=true in non-TTY environment even without --all', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: undefined, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			limit: 100_000,
			all: undefined,
			verbose: undefined,
			silent: undefined,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				all: true,
			}),
		);
	});

	it('passes all=false in TTY environment without --all', async () => {
		Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			limit: 100_000,
			all: undefined,
			verbose: undefined,
			silent: undefined,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				all: false,
			}),
		);
	});

	it('passes silent=true when --silent flag is set', async () => {
		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			limit: 100_000,
			all: undefined,
			verbose: undefined,
			silent: true,
		});

		expect(runReport).toHaveBeenCalledWith(
			expect.objectContaining({
				silent: true,
			}),
		);
	});

	it('calls verbosely when --verbose is set without --silent', async () => {
		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			limit: 100_000,
			all: undefined,
			verbose: true,
			silent: undefined,
		});

		expect(verboselyFn).toHaveBeenCalled();
	});

	it('does not call verbosely when both --verbose and --silent are set', async () => {
		await report(['test.nitpicker'], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			limit: 100_000,
			all: undefined,
			verbose: true,
			silent: true,
		});

		expect(verboselyFn).not.toHaveBeenCalled();
	});

	it('returns early when no file path is provided', async () => {
		await report([], {
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			credentials: './credentials.json',
			config: undefined,
			limit: 100_000,
			all: undefined,
			verbose: undefined,
			silent: undefined,
		});

		expect(runReport).not.toHaveBeenCalled();
	});
});
