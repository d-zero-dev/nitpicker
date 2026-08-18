import { Lanes } from '@d-zero/dealer';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { createSetupLanes } from './setup-lanes.js';

const mockLanesUpdate = vi.fn();
const mockLanesClose = vi.fn();

vi.mock('@d-zero/dealer', () => ({
	Lanes: vi.fn().mockImplementation(function (this: {
		update: typeof mockLanesUpdate;
		close: typeof mockLanesClose;
	}) {
		this.update = mockLanesUpdate;
		this.close = mockLanesClose;
	}),
}));

describe('createSetupLanes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('opens a non-verbose Lanes writing to stderr', () => {
		createSetupLanes(false);

		expect(Lanes).toHaveBeenCalledWith(
			expect.objectContaining({ verbose: false, stream: process.stderr }),
		);
	});

	it('setupProgress.onPhase renders through the Lanes instance', () => {
		const { setupProgress } = createSetupLanes(false);

		setupProgress.onPhase?.('Extracting archive');

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Extracting archive%dots%',
		);
	});

	it('timestamps lines in verbose mode', () => {
		const { setupProgress } = createSetupLanes(true);

		setupProgress.onPhase?.('Extracting archive');

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringMatching(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z .*Extracting archive/,
			),
		);
	});

	it('close() releases the underlying Lanes instance', () => {
		const { close } = createSetupLanes(false);

		close();

		expect(mockLanesClose).toHaveBeenCalledOnce();
	});
});
