/**
 * Input parameters for the search analysis worker.
 */
export type Param = {
	/** The page URL being searched. */
	url: string;
	/** Raw HTML of the page. */
	html: string;
	/** Keyword patterns to search for in the DOM text and attributes. */
	keywords: string[];
	/** CSS selectors to check for existence on the page. */
	selectors: string[];
};

/**
 * Search result for a single page.
 */
export type Result = {
	/** The page URL that was searched. */
	url: string;
	/** Lists of matched keywords and selectors found on the page. */
	matched: {
		/** Keywords that had at least one match. */
		keywords: string[];
		/** Selectors that matched at least one element. */
		selectors: string[];
	};
};
