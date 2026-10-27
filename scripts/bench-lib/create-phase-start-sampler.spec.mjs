import { describe, it, expect, vi } from 'vitest';

import { createPhaseStartSampler } from './create-phase-start-sampler.mjs';

const regionsSample = { physicalFootprintBytes: 1, regions: {} };

describe('createPhaseStartSampler', () => {
	it('records the WAL size per moment, and nothing about regions unless asked', () => {
		const readWal = vi.fn((dir) => (dir === '/a' ? 42 : -1));
		const readRegions = vi.fn(() => regionsSample);
		const sampler = createPhaseStartSampler({
			tmpDir: '/a',
			regions: false,
			readWal,
			readRegions,
		});
		sampler.sample('loadingPageRows');
		sampler.sample('final');
		expect(sampler.walBytesAtPhaseStart).toEqual({ loadingPageRows: 42, final: 42 });
		expect(sampler.memoryRegionsAtPhaseStart).toEqual({});
		expect(readRegions).not.toHaveBeenCalled();
	});

	it('records the regions per moment when asked', () => {
		const sampler = createPhaseStartSampler({
			tmpDir: '/a',
			regions: true,
			readWal: () => 0,
			readRegions: () => regionsSample,
		});
		sampler.sample('committing');
		expect(sampler.memoryRegionsAtPhaseStart).toEqual({ committing: regionsSample });
	});

	it('warns once, with the reader error, when the regions cannot be read, and records null', () => {
		const warn = vi.fn();
		const readRegions = vi.fn(({ onError }) => {
			onError(new Error('vmmap: permission denied'));
			return null;
		});
		const sampler = createPhaseStartSampler({
			tmpDir: '/a',
			regions: true,
			warn,
			readWal: () => 0,
			readRegions,
		});
		sampler.sample('a');
		sampler.sample('b');
		expect(sampler.memoryRegionsAtPhaseStart).toEqual({ a: null, b: null });
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('vmmap: permission denied');
	});

	it('warns once, naming the platform, when no reader exists for it', () => {
		const warn = vi.fn();
		const sampler = createPhaseStartSampler({
			tmpDir: '/a',
			regions: true,
			warn,
			readWal: () => 0,
			readRegions: () => null,
		});
		sampler.sample('a');
		sampler.sample('b');
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('cannot be read on');
	});
});
