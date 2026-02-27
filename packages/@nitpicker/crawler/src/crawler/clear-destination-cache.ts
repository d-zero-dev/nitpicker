import { destinationCache } from './destination-cache.js';

/**
 * Clears the in-memory cache of HTTP request results.
 * Should be called between crawl sessions to prevent memory leaks.
 */
export function clearDestinationCache() {
	destinationCache.clear();
}
