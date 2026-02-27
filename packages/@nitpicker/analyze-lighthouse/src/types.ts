/**
 * Typed subset of a Lighthouse report produced by `Util.prepareReportResult()`.
 *
 * Only the five standard Lighthouse categories are included because
 * the plugin creates dedicated score columns for each one.
 * The `auditRefs` array carries the resolved `result` inline so that
 * consumers can iterate category -> audit without an extra lookup.
 */
export type LHReport = {
	categories: Record<
		'performance' | 'accessibility' | 'best-practices' | 'seo' | 'pwa',
		{
			/** Machine-readable category identifier matching the record key. */
			id: string;
			/** Human-readable category title (e.g. "Performance"). */
			title: string;
			/** Markdown description of the category. */
			description: string;
			/** Description for audits that require manual verification. */
			manualDescription: string;
			/** Aggregate score for the category in the 0-1 range. */
			score: number;
			/** Ordered list of audits that contribute to this category. */
			auditRefs: {
				/** Audit identifier (e.g. `"first-contentful-paint"`). */
				id: string;
				/** Relative weight of this audit within the category score. */
				weight: number;
				/** Audit group label (e.g. `"metrics"`, `"opportunities"`). */
				group?: string;
				/** The resolved audit result, inlined by `prepareReportResult()`. */
				result: ApplicableAuditResult | NotApplicableAuditResult | ErrorAuditResult;
			}[];
		}
	>;
};

/**
 * Base shape shared by all audit result variants.
 */
type AuditResult = {
	/** Audit identifier. */
	id: string;
	/** Short human-readable title describing what the audit checks. */
	title: string;
	/** Markdown description with remediation guidance. */
	description: string;
};

/**
 * An audit that ran successfully and produced a numeric or binary score.
 */
type ApplicableAuditResult = AuditResult & {
	/** Score in the 0-1 range. */
	score: number;
	/**
	 * How the score should be displayed.
	 * - `numeric` / `binary` produce pass/fail ratings.
	 * - `manual` requires human verification.
	 * - `informative` is shown for context only (no pass/fail).
	 */
	scoreDisplayMode: 'numeric' | 'binary' | 'manual' | 'informative';
	/** Raw metric value in the audit's native unit (ms, bytes, etc.). */
	numericValue: number;
	/** Formatted display string (e.g. "1.2 s", "350 KiB"). */
	displayValue: string;
	/** Non-fatal warnings raised during the audit. */
	warnings?: unknown[];
	/** Detailed data table or opportunity breakdown. */
	details?: OpportunityDetails | TableDetails;
};

/**
 * An audit that was skipped because it does not apply to the page
 * (e.g. no `<video>` elements for a video-related audit).
 */
type NotApplicableAuditResult = AuditResult & {
	score: null;
	scoreDisplayMode: 'notApplicable';
};

/**
 * An audit that failed with an internal error.
 */
type ErrorAuditResult = AuditResult & {
	score: null;
	scoreDisplayMode: 'error';
	/** Human-readable error message explaining why the audit failed. */
	errorMessage: string;
};

/**
 * Discriminant base for Lighthouse detail types.
 */
type Details = {
	type: string;
};

/**
 * A detail type that contains a table of items with column headings.
 * Used as a base for both `opportunity` and `table` detail types.
 */
type HeadnessDetails = Details & {
	headings: {
		/** Key into each item record. */
		key: string;
		/** Display type (e.g. `"url"`, `"bytes"`, `"ms"`). */
		valueType: string;
		/** Column header label. */
		label: string;
	}[];
	/** Row data; each record maps heading keys to cell values. */
	items: Record<string, string | number | Code | Node>[];
};

/**
 * An opportunity detail highlighting potential savings.
 * The `overallSavingsMs` value drives the opportunity's display in the report.
 */
type OpportunityDetails = HeadnessDetails & {
	type: 'opportunity';
	/** Total estimated time savings in milliseconds. */
	overallSavingsMs: number;
	/** Total estimated transfer-size savings in bytes, if applicable. */
	overallSavingsBytes?: number;
};

/**
 * A simple tabular detail without savings metadata.
 */
type TableDetails = HeadnessDetails & {
	type: 'table';
};

// type CriticalRequestChainDetails = Details & {
// 	type: 'criticalrequestchain';
// 	chains: Record<
// 		string,
// 		{
// 			request: CriticalRequestChainRequest;
// 			children: Record<
// 				string,
// 				{
// 					request: CriticalRequestChainRequest;
// 				}
// 			>;
// 		}
// 	>;
// 	longestChain: {
// 		duration: number;
// 		length: number;
// 		transferSize: number;
// 	};
// };

// type CriticalRequestChainRequest = {
// 	url: string;
// 	startTime: number;
// 	endTime: number;
// 	responseReceivedTime: number;
// 	transferSize: number;
// };

/**
 * An inline code snippet cell value within a Lighthouse detail table.
 */
type Code = {
	type: 'code';
	/** The raw code string (e.g. a CSS selector or JS expression). */
	value: string;
};

/**
 * A DOM node reference within a Lighthouse detail table.
 * Provides enough context to locate and identify the element in DevTools.
 */
type Node = {
	type: 'node';
	/** CSS selector that uniquely identifies the element. */
	selector: string;
	/** DevTools-style DOM tree path (e.g. `"1,HTML,1,BODY,3,DIV"`). */
	path: string;
	/** Truncated outer HTML of the element. */
	snippet: string;
	/** Why this node was flagged by the audit. */
	explanation: string;
	/** Accessible label or text content of the node. */
	nodeLabel: string;
};
