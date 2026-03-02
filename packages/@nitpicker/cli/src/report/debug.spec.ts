import debug from 'debug';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { verbosely } from './debug.js';

describe('verbosely', () => {
	afterEach(() => {
		debug.disable();
	});

	it('enables Nitpicker debug namespaces', () => {
		verbosely();

		expect(debug.enabled('Nitpicker')).toBe(true);
		expect(debug.enabled('Nitpicker:GoogleSpreadsheet')).toBe(true);
	});

	it('does not re-enable when already enabled', () => {
		debug.enable('Nitpicker*');
		const enableSpy = vi.spyOn(debug, 'enable');

		verbosely();

		expect(enableSpy).not.toHaveBeenCalled();
	});
});
