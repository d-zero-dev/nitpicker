import type { DB_Resource } from './archive/types.js';
import type { ResourceLookupResult } from './crawler/types.js';

import { parseResponseHeaders } from './utils/object/parse-response-headers.js';

/**
 * Convert a raw `resources` table row into the minimal lookup result the
 * crawler needs to reuse captured sub-resource data.
 *
 * Header parsing degrades to `null` on malformed JSON instead of throwing
 * because a missing header set only loses fidelity — the reuse path stays
 * valid.
 * @param row - The raw database row.
 * @returns The lookup result consumed by the crawler's resource-reuse hook.
 */
export function resourceRowToLookupResult(row: DB_Resource): ResourceLookupResult {
	return {
		status: row.status,
		statusText: row.statusText,
		contentType: row.contentType,
		contentLength: row.contentLength,
		responseHeaders: parseResponseHeaders(row.responseHeaders),
	};
}
