import { describe, it, expect, vi } from 'vitest';

import { createSetupProgressCallbacks } from './create-setup-progress-callbacks.js';

describe('createSetupProgressCallbacks', () => {
	it('onPhase renders an animated label line', () => {
		const log = vi.fn();
		const { onPhase } = createSetupProgressCallbacks(log);

		onPhase?.('Extracting archive');

		expect(log).toHaveBeenCalledWith('%braille% Extracting archive%dots%');
	});

	it('onExtractProgress prefixes byte progress with the most recent onPhase label', () => {
		const log = vi.fn();
		const { onPhase, onExtractProgress } = createSetupProgressCallbacks(log);

		onPhase?.('Extracting archive');
		onExtractProgress?.(50_000_000, 200_000_000);

		expect(log).toHaveBeenLastCalledWith('%braille% Extracting archive: 50/200 MB (25%)');
	});

	it('onCopyProgress reuses the current label, distinguishing backup vs. restore via onPhase', () => {
		const log = vi.fn();
		const { onPhase, onCopyProgress } = createSetupProgressCallbacks(log);

		onPhase?.('Backing up archive');
		onCopyProgress?.(10_000_000, 100_000_000);
		expect(log).toHaveBeenLastCalledWith('%braille% Backing up archive: 10/100 MB (10%)');

		onPhase?.('Restoring archive from backup');
		onCopyProgress?.(10_000_000, 100_000_000);
		expect(log).toHaveBeenLastCalledWith(
			'%braille% Restoring archive from backup: 10/100 MB (10%)',
		);
	});

	it('onChunkProgress prefixes count progress with the most recent onPhase label', () => {
		const log = vi.fn();
		const { onPhase, onChunkProgress } = createSetupProgressCallbacks(log);

		onPhase?.('Repromoting external pages');
		onChunkProgress?.(250, 500);

		expect(log).toHaveBeenLastCalledWith(
			'%braille% Repromoting external pages: 250/500 pages (50%)',
		);
	});

	it('deduplicates calls that render to the same message', () => {
		const log = vi.fn();
		const { onPhase, onChunkProgress } = createSetupProgressCallbacks(log);

		onPhase?.('Repromoting external pages');
		log.mockClear();
		onChunkProgress?.(250, 500);
		onChunkProgress?.(250, 500);

		expect(log).toHaveBeenCalledOnce();
	});
});
