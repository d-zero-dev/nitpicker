import type { HeaderEntry, HeaderFlagsRow } from './types.js';

/**
 * Computes the {@link HeaderFlagsRow} for one decomposed header set.
 *
 * Each `has_*` boolean is a straight "is this name present" check on the
 * decomposed entries — semantically equivalent to `checkHeaders` /
 * `headerPresenceExpression` in `@nitpicker/query`, but expressed in JS
 * over the already-normalized `HeaderEntry.name` (lower-cased) so no
 * `LIKE` pattern is needed. This drops the JSON-key-shape false-positive
 * risk that `headerPresenceExpression`'s SQL guard against (a value that
 * happens to mention another header's name won't fire here because names
 * come from the parsed JSON's KEYS, not from a substring scan).
 * @param entries - Every decomposed entry for one `header_sets` row.
 * @returns The row-shaped flags to insert into `header_flags`.
 */
export function computeHeaderFlags(entries: readonly HeaderEntry[]): HeaderFlagsRow {
	const cachePolicies: string[] = [];
	let hasCsp = false;
	let hasXFrameOptions = false;
	let hasXContentTypeOptions = false;
	let hasHsts = false;
	let hasReferrerPolicy = false;
	let hasPermissionsPolicy = false;
	let hasSetCookie = false;
	for (const entry of entries) {
		switch (entry.name) {
			case 'content-security-policy': {
				hasCsp = true;
				break;
			}
			case 'x-frame-options': {
				hasXFrameOptions = true;
				break;
			}
			case 'x-content-type-options': {
				hasXContentTypeOptions = true;
				break;
			}
			case 'strict-transport-security': {
				hasHsts = true;
				break;
			}
			case 'referrer-policy': {
				hasReferrerPolicy = true;
				break;
			}
			case 'permissions-policy': {
				hasPermissionsPolicy = true;
				break;
			}
			case 'set-cookie': {
				hasSetCookie = true;
				break;
			}
			case 'cache-control': {
				cachePolicies.push(entry.value);
				break;
			}
		}
	}
	return {
		has_csp: hasCsp ? 1 : 0,
		has_x_frame_options: hasXFrameOptions ? 1 : 0,
		has_x_content_type_options: hasXContentTypeOptions ? 1 : 0,
		has_hsts: hasHsts ? 1 : 0,
		has_referrer_policy: hasReferrerPolicy ? 1 : 0,
		has_permissions_policy: hasPermissionsPolicy ? 1 : 0,
		has_set_cookie: hasSetCookie ? 1 : 0,
		cache_policy: cachePolicies.length === 0 ? null : cachePolicies.join(', '),
	};
}
