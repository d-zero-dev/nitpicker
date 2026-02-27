/**
 * Error thrown when DOM evaluation (e.g., running scripts within a browser page context)
 * fails. This typically occurs during page scraping when JavaScript execution
 * in the browser context encounters an error.
 */
export class DOMEvaluationError extends Error {}
