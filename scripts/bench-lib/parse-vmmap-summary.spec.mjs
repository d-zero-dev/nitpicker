import { describe, it, expect } from 'vitest';

import { parseVmmapSummary } from './parse-vmmap-summary.mjs';

const SAMPLE = `Process:         node [123]
Path:            /usr/local/bin/node

Physical footprint:         1.5G
Physical footprint (peak):  2.1G
Idle exit:                  untracked
----

ReadOnly portion of Libraries: Total=1.6G resident=29.5M(2%) swapped_out_or_unallocated=1.5G(98%)
Writable regions: Total=97.6M written=272K(0%) resident=1296K(1%) swapped_out=0K(0%) unallocated=96.4M(99%)

                                VIRTUAL RESIDENT    DIRTY  SWAPPED VOLATILE   NONVOL    EMPTY   REGION
REGION TYPE                        SIZE     SIZE     SIZE     SIZE     SIZE     SIZE     SIZE    COUNT (non-coalesced)
===========                     ======= ========    =====  ======= ========   ======    =====  =======
Malloc Small (empty)              4096K      32K      32K       0K       0K       0K       0K        1         see MALLOC ZONE table below
MALLOC_LARGE                      1.2G     1.1G     1.1G       0K       0K       0K       0K       40         see MALLOC ZONE table below
__AUTH                              35K      35K      848       0K       0K       0K       0K       15
mapped file                      256.0M    200.5M       0K       0K       0K       0K       0K        3
shared memory                       48K      48K      48K       0K       0K       0K       0K        2
===========                     ======= ========    =====  ======= ========   ======    =====  =======
TOTAL                            386.8G    80.7M    1776K       0K       0K      16K       0K      356

                                 VIRTUAL   RESIDENT      DIRTY    SWAPPED ALLOCATION      BYTES DIRTY+SWAP          REGION
MALLOC ZONE                         SIZE       SIZE       SIZE       SIZE      COUNT  ALLOCATED  FRAG SIZE  % FRAG   COUNT
DefaultMallocZone_0x1000         1.2G      1.1G      1.1G         0K      12345      1.0G       100M      9%       40
`;

describe('parseVmmapSummary', () => {
	it('reads the physical footprint and each region type as bytes', () => {
		const parsed = parseVmmapSummary(SAMPLE);
		expect(parsed.physicalFootprintBytes).toBe(1.5 * 1024 ** 3);
		expect(parsed.regions['MALLOC_LARGE']).toEqual({
			virtualBytes: 1.2 * 1024 ** 3,
			residentBytes: 1.1 * 1024 ** 3,
			dirtyBytes: 1.1 * 1024 ** 3,
		});
		expect(parsed.regions['mapped file']).toEqual({
			virtualBytes: 256 * 1024 ** 2,
			residentBytes: 200.5 * 1024 ** 2,
			dirtyBytes: 0,
		});
		expect(parsed.regions['shared memory'].residentBytes).toBe(48 * 1024);
	});

	it('keeps a region name that contains spaces and parentheses, and drops the zone note', () => {
		const parsed = parseVmmapSummary(SAMPLE);
		expect(parsed.regions['Malloc Small (empty)']).toEqual({
			virtualBytes: 4096 * 1024,
			residentBytes: 32 * 1024,
			dirtyBytes: 32 * 1024,
		});
	});

	it('reads a size with no unit as bytes', () => {
		expect(parseVmmapSummary(SAMPLE).regions['__AUTH'].dirtyBytes).toBe(848);
	});

	it('does not take the TOTAL row or the malloc zone table as regions', () => {
		const parsed = parseVmmapSummary(SAMPLE);
		expect(parsed.regions['TOTAL']).toBeUndefined();
		expect(
			Object.keys(parsed.regions).some((k) => k.startsWith('DefaultMallocZone')),
		).toBe(false);
		expect(Object.keys(parsed.regions)).toHaveLength(5);
	});

	it('stops at the closing rule, so a TOTAL row after it is not a region even without further rules', () => {
		const text =
			'===========  =\n' +
			'mapped file   1M   512K   0K   0K   0K   0K   0K   1 \n' +
			'===========  =\n' +
			'TOTAL   1M   512K   0K   0K   0K   0K   0K   1 \n';
		expect(Object.keys(parseVmmapSummary(text).regions)).toEqual(['mapped file']);
	});

	it('skips a line in the table whose columns are not sizes and a count', () => {
		const text =
			'===========  =\n' +
			'REGION TYPE  SIZE SIZE SIZE SIZE SIZE SIZE SIZE COUNT (non-coalesced) \n' +
			'mapped file   1M   512K   0K   0K   0K   0K   0K   1 \n' +
			'short row 1M 2M\n' +
			'===========  =\n';
		expect(Object.keys(parseVmmapSummary(text).regions)).toEqual(['mapped file']);
	});

	it('reads a T suffix, so a large reserved range keeps its resident and dirty bytes', () => {
		const text =
			'===========  =\n' +
			'VM_ALLOCATE (reserved)   1.0T   2M   1M   0K   0K   0K   0K   3 \n' +
			'===========  =\n';
		expect(parseVmmapSummary(text).regions['VM_ALLOCATE (reserved)']).toEqual({
			virtualBytes: 1024 ** 4,
			residentBytes: 2 * 1024 ** 2,
			dirtyBytes: 1024 ** 2,
		});
	});

	it('returns null for the footprint when the line is missing', () => {
		expect(parseVmmapSummary('nothing here').physicalFootprintBytes).toBeNull();
		expect(parseVmmapSummary('nothing here').regions).toEqual({});
	});
});
