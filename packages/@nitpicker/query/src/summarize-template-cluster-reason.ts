import type {
	TemplateClusterLandmarkSummary,
	TemplateClusterReasonSummary,
} from './types.js';
import type {
	TemplateClusterLandmarkType,
	TemplateClusterReason,
} from '@nitpicker/crawler';

import { computeStylesheetFileNames } from './compute-stylesheet-file-names.js';

/** First N tokens shown for `structuralCoreTokens`; the rest are counted only. */
const STRUCTURAL_CORE_TOKEN_PREVIEW = 20;
/** First N tokens shown for each landmark's `shellTokens`; the rest are counted only. */
const SHELL_TOKEN_PREVIEW = 10;

/** Fixed display order for landmark rows, independent of object key iteration order. */
const LANDMARK_TYPE_ORDER: readonly TemplateClusterLandmarkType[] = [
	'header',
	'footer',
	'nav',
	'aside',
	'form',
	'search',
];

/**
 * Reduces a verbatim {@link TemplateClusterReason} (as stored in
 * `page_template_clusters.reason_json`) to the trimmed
 * {@link TemplateClusterReasonSummary} shape sent over `/api/template-clusters`.
 *
 * The verbatim payload is kept in full in the archive (see
 * `replacePageTemplates`'s own JSDoc for why) because a follow-up consumer
 * might need the complete token/shell-token sets (e.g. Jaccard comparison
 * across sibling clusters); the API response trims large arrays instead,
 * since a `structuralCoreTokens` set can run into the hundreds per cluster
 * and every cluster on the archive is returned in one response (see
 * `register-template-clusters-route.ts`'s own JSDoc on why there's no
 * pagination).
 * @param reason - The verbatim reason to summarize.
 * @returns The trimmed summary.
 * @example
 * const summary = summarizeTemplateClusterReason(reason);
 */
export function summarizeTemplateClusterReason(
	reason: TemplateClusterReason,
): TemplateClusterReasonSummary {
	const distinctiveStylesheetUrls = [
		...new Set(
			reason.blocking.flatMap((b) =>
				b.reason.kind === 'css' ? b.reason.distinctiveStylesheetHrefs : [],
			),
		),
	].toSorted();

	const landmarks: TemplateClusterLandmarkSummary[] = [];
	for (const type of LANDMARK_TYPE_ORDER) {
		const profile = reason.landmarks[type];
		if (!profile) {
			continue;
		}
		landmarks.push({
			type,
			presenceRate: profile.presenceRate,
			chromeRate: profile.chromeRate,
			memberCountWithInstance: profile.memberCountWithInstance,
			shellTokens: profile.shellTokens.slice(0, SHELL_TOKEN_PREVIEW),
			shellTokenCount: profile.shellTokens.length,
		});
	}

	return {
		clusteredMemberCount: reason.memberCount,
		blocking: [...reason.blocking],
		distinctiveStylesheetUrls,
		distinctiveStylesheetFileNames: computeStylesheetFileNames(distinctiveStylesheetUrls),
		structuralCoreTokens: reason.structuralCoreTokens.slice(
			0,
			STRUCTURAL_CORE_TOKEN_PREVIEW,
		),
		structuralCoreTokenCount: reason.structuralCoreTokens.length,
		landmarks,
		siblingClusterKeys: [...reason.siblingClusterKeys],
	};
}
