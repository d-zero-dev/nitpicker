import type {
	TemplateClusterBlockingEvidence,
	TemplateClusterBlockingReason,
	TemplateClusterLandmarkProfile,
	TemplateClusterReason,
} from '@nitpicker/crawler';

/**
 * Validates one `blocking[].reason`'s shape against its `kind` discriminant.
 * @param value
 */
function isTemplateClusterBlockingReason(
	value: unknown,
): value is TemplateClusterBlockingReason {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.kind === 'css') {
		return Array.isArray(candidate.distinctiveStylesheetHrefs);
	}
	if (candidate.kind === 'path' || candidate.kind === 'orphanMerge') {
		return typeof candidate.pathKey === 'string';
	}
	return false;
}

/**
 * Validates one `blocking[]` entry's shape.
 * @param value
 */
function isTemplateClusterBlockingEvidence(
	value: unknown,
): value is TemplateClusterBlockingEvidence {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.blockKey === 'string' &&
		isTemplateClusterBlockingReason(candidate.reason)
	);
}

/**
 * Validates one `landmarks` value's shape.
 * @param value
 */
function isTemplateClusterLandmarkProfile(
	value: unknown,
): value is TemplateClusterLandmarkProfile {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.presenceRate === 'number' &&
		typeof candidate.chromeRate === 'number' &&
		Array.isArray(candidate.shellTokens) &&
		typeof candidate.memberCountWithInstance === 'number'
	);
}

/**
 * Structurally validates a decoded `page_template_clusters.reason_json`
 * payload against the current {@link TemplateClusterReason} shape,
 * including every `blocking[]` entry and `landmarks` value — a shallow
 * check (top-level fields only) would let a malformed nested entry through,
 * which then throws inside `summarizeTemplateClusterReason` (e.g. reading
 * `.kind` off a non-object `reason`) instead of being caught here.
 *
 * `@d-zero/page-cluster`'s `ClusterReason` is not versioned against the
 * archive format — an archive written with an older/newer version of that
 * library could carry a payload this reader doesn't recognize. This guard
 * is the boundary that keeps a shape mismatch from surfacing as a crash
 * deep inside the viewer: an unrecognized payload is treated as "no reason
 * available" (mirroring `decodeJsonRef`'s own fail-closed-to-`null`
 * contract), not as a hard error.
 * @param value - The `JSON.parse`d payload to validate.
 * @returns Whether `value` matches the shape `TemplateClusterReason` expects.
 * @example
 * const parsed: unknown = JSON.parse(decoded);
 * if (isTemplateClusterReason(parsed)) {
 *   // parsed is TemplateClusterReason
 * }
 */
export function isTemplateClusterReason(value: unknown): value is TemplateClusterReason {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.memberCount !== 'number' ||
		!Array.isArray(candidate.blocking) ||
		!Array.isArray(candidate.structuralCoreTokens) ||
		!Array.isArray(candidate.siblingClusterKeys) ||
		typeof candidate.landmarks !== 'object' ||
		candidate.landmarks === null
	) {
		return false;
	}
	if (!candidate.blocking.every((entry) => isTemplateClusterBlockingEvidence(entry))) {
		return false;
	}
	return Object.values(candidate.landmarks).every((profile) =>
		isTemplateClusterLandmarkProfile(profile),
	);
}
