import { describe, it, expect, vi } from 'vitest';

import { createByteProgressLogger } from './create-byte-progress-logger.js';

describe('createByteProgressLogger', () => {
	it('formats bytes as MB with a percentage', () => {
		const logLine = vi.fn();
		const onProgress = createByteProgressLogger(logLine, 'Extracting archive');

		onProgress(50_000_000, 200_000_000);

		expect(logLine).toHaveBeenCalledWith('%braille% Extracting archive: 50/200 MB (25%)');
	});

	it('deduplicates calls that render to the same message', () => {
		const logLine = vi.fn();
		const onProgress = createByteProgressLogger(logLine, 'Extracting archive');

		onProgress(50_000_000, 200_000_000);
		// Rounds to the same "50 MB" — must not repaint.
		onProgress(50_400_000, 200_000_000);

		expect(logLine).toHaveBeenCalledOnce();
	});

	it('logs again once the rendered message actually changes', () => {
		const logLine = vi.fn();
		const onProgress = createByteProgressLogger(logLine, 'Extracting archive');

		onProgress(50_000_000, 200_000_000);
		onProgress(51_000_000, 200_000_000);

		expect(logLine).toHaveBeenCalledTimes(2);
		expect(logLine).toHaveBeenLastCalledWith(
			'%braille% Extracting archive: 51/200 MB (25%)',
		);
	});

	it('reports completion at 100%', () => {
		const logLine = vi.fn();
		const onProgress = createByteProgressLogger(logLine, 'Writing archive');

		onProgress(200_000_000, 200_000_000);

		expect(logLine).toHaveBeenCalledWith('%braille% Writing archive: 200/200 MB (100%)');
	});

	it('omits the %braille% placeholder when animated: false', () => {
		const logLine = vi.fn();
		const onProgress = createByteProgressLogger(logLine, 'Extracting archive', {
			animated: false,
		});

		onProgress(50_000_000, 200_000_000);

		expect(logLine).toHaveBeenCalledWith('Extracting archive: 50/200 MB (25%)');
	});

	it('does not report a false 100% for an archive under 500 KB (issue #294 code review)', () => {
		// A total under 500 KB rounds to 0 MB, which `formatProgressCount`
		// would otherwise read as "nothing to do" and report 100% before
		// extraction even starts.
		const logLine = vi.fn();
		const onProgress = createByteProgressLogger(logLine, 'Extracting archive');

		onProgress(100_000, 400_000);

		expect(logLine).toHaveBeenCalledWith('%braille% Extracting archive: 0/1 MB (0%)');
	});

	it('reports 100% once a sub-500 KB archive actually completes', () => {
		const logLine = vi.fn();
		const onProgress = createByteProgressLogger(logLine, 'Extracting archive');

		onProgress(400_000, 400_000);

		expect(logLine).toHaveBeenCalledWith('%braille% Extracting archive: 1/1 MB (100%)');
	});
});
