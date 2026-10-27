import { describe, it, expect, vi } from 'vitest';

import { readMemoryRegions } from './read-memory-regions.mjs';

describe('readMemoryRegions', () => {
	it('runs vmmap --summary on the process and parses it on darwin', () => {
		const runVmmap = vi.fn(
			() =>
				'Physical footprint:         10M\n' +
				'===========  =\n' +
				'mapped file   1M   512K   0K   0K   0K   0K   0K   1 \n' +
				'===========  =\n' +
				'TOTAL   1M   512K   0K   0K   0K   0K   0K   1 \n',
		);
		const result = readMemoryRegions({ platform: 'darwin', pid: 42, runVmmap });
		expect(runVmmap).toHaveBeenCalledWith(42);
		expect(result).toEqual({
			physicalFootprintBytes: 10 * 1024 ** 2,
			regions: {
				'mapped file': {
					virtualBytes: 1024 ** 2,
					residentBytes: 512 * 1024,
					dirtyBytes: 0,
				},
			},
		});
	});

	it('reads /proc/self/status on linux', () => {
		const readProcStatus = vi.fn(() => 'VmRSS:\t 100 kB\nRssAnon:\t 60 kB\n');
		const result = readMemoryRegions({ platform: 'linux', pid: 1, readProcStatus });
		expect(readProcStatus).toHaveBeenCalled();
		expect(result).toEqual({
			physicalFootprintBytes: 100 * 1024,
			regions: { RssAnon: { residentBytes: 60 * 1024 } },
		});
	});

	it('returns null on a platform it cannot read', () => {
		expect(readMemoryRegions({ platform: 'win32', pid: 1 })).toBeNull();
	});

	it('returns null instead of throwing when the reader fails, and hands the error to onError', () => {
		const failure = new Error('vmmap: permission denied');
		const runVmmap = () => {
			throw failure;
		};
		const onError = vi.fn();
		expect(
			readMemoryRegions({ platform: 'darwin', pid: 1, runVmmap, onError }),
		).toBeNull();
		expect(onError).toHaveBeenCalledWith(failure);
	});

	it('does not need onError to be given when the reader fails', () => {
		const runVmmap = () => {
			throw new Error('vmmap: permission denied');
		};
		expect(readMemoryRegions({ platform: 'darwin', pid: 1, runVmmap })).toBeNull();
	});
});
