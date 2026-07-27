import type { OutageWindow } from '../is-within-outage-window.js';
import type { ErrorKind } from '../types.js';

import { isWithinOutageWindow } from '../is-within-outage-window.js';

/**
 * Undo `dnsBurnedHostCache` burns whose recorded timestamp (see
 * `dns-burned-host-burn-timestamps.ts`) falls inside `window` — i.e. hosts
 * THIS session burned because a HEAD request failed with a
 * `dns`-classified error while (or just before) the operator's own network
 * was down, not because the host is actually dead.
 *
 * Preload-seeded burns are structurally immune: they never appear in
 * `burnTimestamps` (see that module's docstring), so this function can
 * never touch them regardless of the window.
 * @param options - Named parameters.
 * @param options.cache - `dnsBurnedHostCache` (or a test double with the same shape).
 * @param options.burnTimestamps - `dnsBurnedHostBurnTimestamps` (or a test double).
 * @param options.window - The just-resolved outage window (`{ startedAt, endedAt }`)
 *   to test each burn's timestamp against.
 */
export function evictOutageTaintedDnsBurns(options: {
	cache: Map<string, ErrorKind>;
	burnTimestamps: Map<string, number>;
	window: OutageWindow;
}): void {
	const { cache, burnTimestamps, window } = options;
	for (const [host, burnedAt] of burnTimestamps) {
		if (isWithinOutageWindow(burnedAt, [window])) {
			cache.delete(host);
			burnTimestamps.delete(host);
		}
	}
}
