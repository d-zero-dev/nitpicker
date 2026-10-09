/**
 * Compares two semver-like version strings.
 *
 * Only the major / minor / patch numeric components are considered;
 * pre-release tags (`-alpha.1`) and build metadata (`+sha.abc`) are
 * dropped before comparison so `"0.10.0-alpha.1"` compares equal to
 * `"0.10.0"`. Missing components default to `0`, so `"0.10"` compares
 * equal to `"0.10.0"`.
 *
 * Designed for `assertCompatibleVersion`'s
 * "is the archive's `info.version` at least the required format
 * version?" check — we do not need full semver semantics there, and
 * pulling in the `semver` package would be overkill for one numeric
 * comparison.
 * @param a - The left-hand version string.
 * @param b - The right-hand version string.
 * @returns Negative when `a < b`, positive when `a > b`, zero when equal.
 * @example
 * compareSemver('0.9.0', '0.10.0')          // → -1
 * compareSemver('0.10.0', '0.10.0')         // → 0
 * compareSemver('0.10.5-alpha.1', '0.10.0') // → +5
 */
export function compareSemver(a: string, b: string): number {
	const pa = parseComponents(a);
	const pb = parseComponents(b);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/**
 * Strips pre-release / build metadata and parses the first three numeric
 * components. Missing components default to `0`. Non-numeric components
 * collapse to `0` rather than throwing — `assertCompatibleVersion` needs
 * defensive behavior against hand-edited `info.version` strings.
 * @param version
 */
function parseComponents(version: string): [number, number, number] {
	const core = version.split(/[-+]/)[0] ?? '';
	const parts = core.split('.');
	const major = Number.parseInt(parts[0] ?? '0', 10);
	const minor = Number.parseInt(parts[1] ?? '0', 10);
	const patch = Number.parseInt(parts[2] ?? '0', 10);
	return [
		Number.isFinite(major) ? major : 0,
		Number.isFinite(minor) ? minor : 0,
		Number.isFinite(patch) ? patch : 0,
	];
}
