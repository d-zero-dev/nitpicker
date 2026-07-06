import { describe, expect, it } from 'vitest';

import { buildFilterKey } from './build-filter-key.js';

describe('buildFilterKey', () => {
	it('produces the same key whether a per-table wrapper is called with an empty options object or one that names every field as undefined — the two shapes callers actually pass', () => {
		/**
		 * Simulates a per-table wrapper's fixed-shape object literal, e.g. `buildViewerResourcesFilterKey`.
		 * @param options
		 * @param options.isExternal
		 * @param options.status
		 */
		function wrapperFilterKey(options: {
			isExternal?: boolean;
			status?: number;
		}): string {
			return buildFilterKey({ isExternal: options.isExternal, status: options.status });
		}
		expect(wrapperFilterKey({})).toBe(
			wrapperFilterKey({ isExternal: undefined, status: undefined }),
		);
	});

	it('coalesces undefined to null rather than dropping the key', () => {
		expect(buildFilterKey({ status: undefined })).toBe(JSON.stringify({ status: null }));
	});

	it('preserves the caller-supplied key order', () => {
		expect(buildFilterKey({ b: 1, a: 2 })).toBe(JSON.stringify({ b: 1, a: 2 }));
	});

	it('produces a different key for a different value', () => {
		expect(buildFilterKey({ status: 200 })).not.toBe(buildFilterKey({ status: 404 }));
	});
});
