/**
 * Normalized representation of a single axe-core finding.
 *
 * This is a simplified projection of axe-core's native `Result` type,
 * keeping only the fields needed for the Nitpicker violation report.
 * All fields are optional because the same type is reused for both
 * successful axe runs (where `id`, `impact`, etc. are present) and
 * error fallback records (where only `description` is set).
 */
export type Result = {
	/** Human-readable description of the issue or error message. */
	description?: string;
	/** Short suggestion for how to fix the issue (axe `help` field). */
	help?: string;
	/** URL pointing to the axe-core documentation for this rule. */
	helpUrl?: string;
	/** The axe rule identifier (e.g. `"aria-roles"`, `"image-alt"`). */
	id?: string;
	/**
	 * Severity level assigned by axe-core.
	 *
	 * Typed as `unknown` rather than the axe-core enum because this type
	 * is also used for error fallback records where impact is absent.
	 * The plugin normalizes this to a string at the Violation mapping step.
	 */
	impact?: unknown;
	/** WCAG tags associated with the rule (e.g. `["wcag2a", "wcag412"]`). */
	tags?: unknown[];
	/** DOM nodes that triggered the finding, each containing `html` and/or `target`. */
	nodes?: unknown[];
};
