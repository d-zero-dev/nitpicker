import { describe, expect, it } from 'vitest';

import { RECRAWL_SETUP_PHASES } from './recrawl-setup-phases.js';

describe('RECRAWL_SETUP_PHASES', () => {
	it('lists the thirteen-phase superset sequence, in call order — guards against accidental drift', () => {
		// Identical to INVENTORY_SETUP_PHASES except for the extra 'Resetting
		// matched pages' step right after 'Backing up archive' — order matters
		// here (unlike a Set-based kind list): the CLI's setup task list
		// pre-builds one row per entry in this exact sequence and marks
		// whichever suffix a given run never reaches as skipped. Note 'Loading
		// crawl state' appears twice (indices 2 and 9) — the first read is
		// pre-ingestion, the second re-reads after the reset pages and new
		// seeds are written; both rows exist even though the label text is
		// identical.
		expect(RECRAWL_SETUP_PHASES).toEqual([
			'Extracting archive',
			'Loading archive config',
			'Loading crawl state',
			'Checking for already-known URLs',
			'Backing up archive',
			'Resetting matched pages',
			'Recording non-HTML resources',
			'Recording HTML seed pages',
			'Recording excluded pages',
			'Loading crawl state',
			'Loading resource list',
			'Loading scraped page count',
			'Restoring crawl state',
		]);
	});
});
