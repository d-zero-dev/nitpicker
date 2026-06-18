import { dnsBurnedHostCache } from './dns-burned-host-cache.js';
import { dnsBurnedHostShortCircuitCounter } from './dns-burned-host-short-circuit-counter.js';

/**
 * Clears the DNS-burned host cache and resets the short-circuit counter.
 * Called between crawl sessions, alongside {@link clearDestinationCache}, to
 * avoid leaking state from a previous session into a fresh one.
 */
export function clearDnsBurnedHostCache() {
	dnsBurnedHostCache.clear();
	dnsBurnedHostShortCircuitCounter.count = 0;
}
