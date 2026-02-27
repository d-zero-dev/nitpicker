import type { Resource } from '../utils/index.js';

/**
 * Track a network resource response and determine if it is newly discovered.
 *
 * Checks whether the resource URL has already been seen. If it is new,
 * adds it to the known resources set.
 * @param resource - The captured network resource data.
 * @param resources - The set of already-known resource URLs (without hash).
 * @returns An object with `isNew` indicating whether this resource was seen for the first time.
 */
export function handleResourceResponse(
	resource: Resource,
	resources: Set<string>,
): { isNew: boolean } {
	const isNew = !resources.has(resource.url.withoutHash);
	if (isNew) {
		resources.add(resource.url.withoutHash);
	}
	return { isNew };
}
