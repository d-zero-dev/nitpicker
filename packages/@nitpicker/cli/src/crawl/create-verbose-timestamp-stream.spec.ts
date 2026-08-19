import { describe, expect, it, vi } from 'vitest';

import { createVerboseTimestampStream } from './create-verbose-timestamp-stream.js';

describe('createVerboseTimestampStream', () => {
	it('prefixes each write() call with an ISO 8601 timestamp', () => {
		const write = vi.fn();
		const base = { write } as unknown as NodeJS.WritableStream;

		const wrapped = createVerboseTimestampStream(base);
		wrapped.write('✔ Extracting archive (1.2s)\n');

		expect(write).toHaveBeenCalledTimes(1);
		const [written] = write.mock.calls[0]!;
		expect(written).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ✔ Extracting archive \(1\.2s\)\n$/,
		);
	});

	it('forwards write() arguments beyond the chunk untouched', () => {
		const write = vi.fn();
		const base = { write } as unknown as NodeJS.WritableStream;
		const callback = vi.fn();

		const wrapped = createVerboseTimestampStream(base);
		wrapped.write('line\n', 'utf8', callback);

		expect(write).toHaveBeenCalledWith(
			expect.stringContaining('line\n'),
			'utf8',
			callback,
		);
	});

	it('forwards non-write properties to the underlying stream', () => {
		const on = vi.fn();
		const base = { write: vi.fn(), on } as unknown as NodeJS.WritableStream & {
			on: typeof on;
		};

		const wrapped = createVerboseTimestampStream(base) as NodeJS.WritableStream & {
			on: typeof on;
		};
		const listener = () => {};
		wrapped.on('resize', listener);

		expect(on).toHaveBeenCalledWith('resize', listener);
	});
});
