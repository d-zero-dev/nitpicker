import type { DecomposedHeaderSet, HeaderEntry } from './types.js';

import { computeContentHash } from './compute-content-hash.js';
import { isVolatileHeader } from './header-stability.js';

/**
 * Parses one raw `responseHeaders` JSON string and produces the derived
 * data shape required to insert into `header_sets`, `header_set_entries`,
 * and `header_flags`.
 *
 * Behaviour:
 *
 * - `null` / `""` / `"null"` / `"{}"` / non-object JSON → returns `null`.
 *   The caller sets `header_set_id = null` on the referring row.
 * - Multiple values per header name (JSON arrays, e.g.
 *   `{ "set-cookie": ["a=1", "b=2"] }`) become multiple
 *   {@link HeaderEntry} rows with `occurrence` ordinals 1, 2, ... The
 *   composite PK on `header_set_entries` `(header_set_id, name_id,
 *   occurrence)` guarantees no truncation.
 * - Names are lower-cased. Values are trimmed of whitespace only in the
 *   sorted-hash construction; the raw value is preserved verbatim in
 *   the emitted `HeaderEntry.value` (and hence in `header_value_refs`).
 *   Trimming inside hash construction lets `content-type: text/html`
 *   and `content-type:  text/html ` dedup to one stable set.
 * - Sort order for hashing is `(name, occurrence)` in binary form —
 *   deterministic regardless of the input JSON's insertion order or
 *   how the JSON serializer arranged keys.
 * @param rawJson - The raw JSON string exactly as stored in
 *   `pages.responseHeaders` / `resources.responseHeaders`.
 * @returns Decomposed shape, or `null` when the row has no meaningful
 *   header set.
 */
export function decomposeHeaderSet(rawJson: string | null): DecomposedHeaderSet | null {
	if (rawJson == null || rawJson === '' || rawJson === 'null' || rawJson === '{}') {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawJson);
	} catch {
		return null;
	}
	if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return null;
	}

	const entries: HeaderEntry[] = [];
	// `occurrence` runs per (lower-cased name) across ALL sources for that
	// name, so duplicate JSON keys that differ only in case
	// (`{"Cookie":"a=1", "cookie":"b=2"}` — non-conforming but legal JSON,
	// and the crawler stores whatever puppeteer hands it) don't collide on
	// (name_id, occurrence). Without this counter the second entry would
	// land at occurrence=1 too, violating the `header_set_entries` PK and
	// silently getting dropped by INSERT OR IGNORE while `entry_count`
	// still counted it.
	const occurrenceByName = new Map<string, number>();
	for (const [rawName, rawValue] of Object.entries(parsed)) {
		const name = rawName.toLowerCase();
		const volatile = isVolatileHeader(name);
		const nextOccurrence = (): number => {
			const next = (occurrenceByName.get(name) ?? 0) + 1;
			occurrenceByName.set(name, next);
			return next;
		};
		if (Array.isArray(rawValue)) {
			for (const one of rawValue) {
				if (typeof one !== 'string') {
					continue;
				}
				entries.push({
					name,
					value: one,
					occurrence: nextOccurrence(),
					isVolatile: volatile,
				});
			}
			continue;
		}
		if (typeof rawValue !== 'string') {
			// parseResponseHeaders's stored shape is `Record<string, string |
			// string[] | undefined>`, but hand-edited or non-conforming
			// archives could smuggle in a nested object / number / boolean
			// — coercing via `String()` would produce "[object Object]" and
			// pollute `header_value_refs` with a garbage dictionary entry.
			// Skipping is the conservative choice; the source row's raw
			// JSON is still preserved via `raw_json_hash`.
			continue;
		}
		entries.push({
			name,
			value: rawValue,
			occurrence: nextOccurrence(),
			isVolatile: volatile,
		});
	}

	if (entries.length === 0) {
		return null;
	}

	entries.sort((a, b) => {
		if (a.name < b.name) return -1;
		if (a.name > b.name) return 1;
		return a.occurrence - b.occurrence;
	});

	// Canonicalize every entry exactly once, then partition the strings —
	// prior version canonicalized each stable entry twice (once in the
	// all-entries pass, once in the stable pass) and each volatile entry
	// twice likewise, which becomes measurable on large archives where a
	// single response can carry a couple of dozen entries.
	const canonicalStrings = entries.map(canonicalize);
	const stableCanonical: string[] = [];
	const volatileCanonical: string[] = [];
	let stableEntryCount = 0;
	for (const [i, entry] of entries.entries()) {
		if (entry.isVolatile) {
			volatileCanonical.push(canonicalStrings[i]!);
		} else {
			stableCanonical.push(canonicalStrings[i]!);
			stableEntryCount += 1;
		}
	}

	const rawJsonHash = computeContentHash(rawJson);
	const rawHash = computeContentHash(canonicalStrings.join('\n'));
	// A response with only volatile headers (tracker endpoints that return
	// just `Date` / `Set-Cookie` / `Age`) hashes to `computeContentHash('')`
	// — the canonical "empty stable profile" hash. All all-volatile
	// responses cluster under this sentinel, which is the intended
	// semantic (same empty stable profile = same cluster), and Phase 6-A's
	// DDL declares `stable_hash BLOB NOT NULL` so a `null` sentinel is not
	// available even if we wanted one. Consumers that need to distinguish
	// "empty stable set" from "populated stable set" should key off
	// `stable_entry_count === 0` on the same row, not off the hash.
	const stableHash = computeContentHash(stableCanonical.join('\n'));
	const volatileHash =
		volatileCanonical.length === 0
			? null
			: computeContentHash(volatileCanonical.join('\n'));

	return {
		rawJsonHash,
		rawHash,
		stableHash,
		volatileHash,
		entries,
		entryCount: entries.length,
		stableEntryCount,
	};
}

/**
 * Serializes one entry into the canonical `name/occurrence=value` form
 * used inside the hash construction. The trailing occurrence keeps
 * multi-value headers distinguishable while still letting single-value
 * ones dedup naturally. Values are trimmed so surrounding whitespace
 * does not fork the dedup key.
 * @param entry - One decomposed header entry.
 * @returns Canonical string joined into the hash pre-image.
 */
function canonicalize(entry: HeaderEntry): string {
	return `${entry.name}/${entry.occurrence}=${entry.value.trim()}`;
}
