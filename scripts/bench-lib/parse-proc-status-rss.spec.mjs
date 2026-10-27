import { describe, it, expect } from 'vitest';

import { parseProcStatusRss } from './parse-proc-status-rss.mjs';

const SAMPLE = `Name:\tnode
VmPeak:\t 3000000 kB
VmRSS:\t 2000000 kB
RssAnon:\t 1500000 kB
RssFile:\t  400000 kB
RssShmem:\t 100000 kB
Threads:\t12
`;

describe('parseProcStatusRss', () => {
	it('splits the resident set into anonymous, file-backed and shared memory, in bytes', () => {
		expect(parseProcStatusRss(SAMPLE)).toEqual({
			physicalFootprintBytes: 2_000_000 * 1024,
			regions: {
				RssAnon: { residentBytes: 1_500_000 * 1024 },
				RssFile: { residentBytes: 400_000 * 1024 },
				RssShmem: { residentBytes: 100_000 * 1024 },
			},
		});
	});

	it('returns null and no regions when the fields are missing', () => {
		expect(parseProcStatusRss('Name:\tnode\n')).toEqual({
			physicalFootprintBytes: null,
			regions: {},
		});
	});
});
