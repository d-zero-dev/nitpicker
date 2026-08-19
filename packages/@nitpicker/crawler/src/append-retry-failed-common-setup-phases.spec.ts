import { describe, expect, it } from 'vitest';

import { APPEND_RETRY_FAILED_COMMON_SETUP_PHASES } from './append-retry-failed-common-setup-phases.js';
import { APPEND_SETUP_PHASES } from './append-setup-phases.js';
import { RETRY_FAILED_SETUP_PHASES } from './retry-failed-setup-phases.js';

describe('APPEND_RETRY_FAILED_COMMON_SETUP_PHASES', () => {
	it('lists the shared prefix and suffix — guards against accidental drift', () => {
		expect(APPEND_RETRY_FAILED_COMMON_SETUP_PHASES).toEqual({
			prefix: ['Extracting archive', 'Loading archive config', 'Backing up archive'],
			suffix: [
				'Loading dedupe-cap shape keys',
				'Loading crawl state',
				'Loading resource list',
				'Loading scraped page count',
				'Restoring crawl state',
			],
		});
	});

	it('is what APPEND_SETUP_PHASES and RETRY_FAILED_SETUP_PHASES actually share, so the two can never silently drift apart', () => {
		const { prefix, suffix } = APPEND_RETRY_FAILED_COMMON_SETUP_PHASES;
		expect(APPEND_SETUP_PHASES.slice(0, prefix.length)).toEqual(prefix);
		expect(APPEND_SETUP_PHASES.slice(-suffix.length)).toEqual(suffix);
		expect(RETRY_FAILED_SETUP_PHASES.slice(0, prefix.length)).toEqual(prefix);
		expect(RETRY_FAILED_SETUP_PHASES.slice(-suffix.length)).toEqual(suffix);
	});
});
