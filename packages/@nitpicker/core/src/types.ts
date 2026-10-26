/**
 * The functions the native addon (`crates/nitpicker_napi`) exports, as seen
 * from JavaScript. Kept in sync with the `#[napi]` functions by hand — the
 * addon's own generated typings are not used, so every export goes through a
 * documented one-function-per-file wrapper instead.
 */
export interface NativeBinding {
	/** See `compute-body-hash.ts`. */
	computeBodyHash(html: Uint8Array): Buffer;
	/** See `match-structural-technology-signals.ts`. */
	matchStructuralTechnologySignals(html: Uint8Array): StructuralTechnologySignal[];
	/** See `match-js-license-comment-signal.ts`. */
	matchJsLicenseCommentSignal(script: Uint8Array): StructuralTechnologySignal | null;
	/** See `match-selector-html.ts`. */
	matchSelectorHtml(plan: NativeSelectorPlan, html: Uint8Array): HtmlMatchOutcome;
	/** See `match-selector-snapshots.ts`. */
	matchSelectorSnapshots(
		plan: NativeSelectorPlan,
		bodies: Uint8Array,
		offsets: Uint32Array,
		codecs: Uint8Array,
		cancelToken?: NativeCancelToken,
	): Promise<Uint8Array>;
	/** See `validate-search-pattern.ts`. */
	validateSearchPattern(pattern: NativeSearchPattern): boolean;
	/** See `search-html-document.ts`. */
	searchHtmlDocument(
		pattern: NativeSearchPattern,
		html: Uint8Array,
		snippetLength: number,
	): SnapshotSearchOutcome;
	/** See `search-html-snapshots.ts`. */
	searchHtmlSnapshots(
		pattern: NativeSearchPattern,
		snippetLength: number,
		bodies: Uint8Array,
		offsets: Uint32Array,
		codecs: Uint8Array,
		cancelToken?: NativeCancelToken,
	): Promise<{ matchCounts: number[]; snippets: string[] }>;
	/** See `check-native-executor-config.ts`. */
	checkNativeExecutorConfig(): void;
	/** See `run-with-signal.ts`. */
	NativeCancelToken: new () => NativeCancelToken;
	/** See `compute-url-sort-ranks.ts`. */
	computeUrlSortRanks(urls: Uint8Array, offsets: Uint32Array): Uint32Array;
	/** See `compute-alias-keys.ts`. */
	computeAliasKeys(url: string): { tierA: string; tierB: string } | null;
	/** See `group-alias-candidates.ts`. */
	groupAliasCandidates(input: NativeAliasCandidates): Uint32Array;
	/** See `create-isolated-cluster-run.ts`. */
	IsolatedClusterRun: new (
		candidateIds: Uint32Array,
		redirects: Uint32Array,
	) => NativeIsolatedClusterRun;
	/** See `create-template-classification-run.ts`. */
	TemplateClassificationRun: new (
		onProgress?: (event: NativeTemplateClassificationProgress) => void,
		memoryBudget?: number,
	) => NativeTemplateClassificationRun;
	/** See `template-block-sample-size.ts`. */
	TEMPLATE_BLOCK_SAMPLE_SIZE: number;
	/** See `template-memory-budget.ts`. */
	TEMPLATE_MEMORY_BUDGET: number;
	/** See `template-exact-page-limit.ts`. */
	TEMPLATE_EXACT_PAGE_LIMIT: number;
}

/**
 * Stops the asynchronous native calls it was passed to. Raising it is one-way;
 * a call that sees it raised rejects with code `Cancelled`.
 */
export interface NativeCancelToken {
	/** Raises the token. */
	cancel(): void;
}

/** How two adjacent compounds of a complex selector are joined. */
export type SelectorCombinator = 'descendant' | 'child';

/** The attribute selector operators the matcher evaluates. */
export type SelectorAttributeOperator =
	| 'exists'
	| 'equals'
	| 'includes'
	| 'dash'
	| 'prefix'
	| 'suffix'
	| 'substring';

/** One attribute condition of a compound (`[a]`, `[a^=v]`, `.cls`, `#id`, ...). */
export interface SelectorAttributeTest {
	/** Lower-cased attribute name. */
	readonly name: string;
	readonly operator: SelectorAttributeOperator;
	/** The selector's literal value (empty for `exists`). */
	readonly value: string;
	/** Whether values compare ignoring ASCII case. */
	readonly ignoreCase: boolean;
}

/** An `An+B` position test (`:nth-child`, `:nth-of-type`, `:first-*`). */
export interface SelectorNthTest {
	readonly kind: 'child' | 'of-type';
	readonly a: number;
	readonly b: number;
}

/** The compound inside `:not(...)` — a compound without negations of its own. */
export interface SelectorNegatedCompound {
	/** Lower-cased tag name, or `null` for any element. */
	readonly tag: string | null;
	readonly attributes: readonly SelectorAttributeTest[];
	readonly nth: readonly SelectorNthTest[];
}

/** A compound selector: every condition must hold on one element. */
export interface SelectorCompound extends SelectorNegatedCompound {
	readonly negations: readonly SelectorNegatedCompound[];
}

/** One comma alternative of a selector list. */
export interface SelectorAlternative {
	/** Compounds in source (ancestor-first) order; between 1 and 30. */
	readonly compounds: readonly SelectorCompound[];
	/** `combinators[j - 1]` joins `compounds[j - 1]` and `compounds[j]`. */
	readonly combinators: readonly SelectorCombinator[];
	/**
	 * Lower-cased printable-ASCII literals that must occur in the document in
	 * this order for the alternative to match, or `null` when none can be derived.
	 */
	readonly prefilterLiterals: readonly string[] | null;
	/**
	 * Whether one start tag decides this alternative: a single compound with
	 * no position test whose attribute values have a single stored form.
	 */
	readonly direct: boolean;
}

/** A validated selector list as the matcher evaluates it. */
export interface SelectorPlan {
	readonly alternatives: readonly SelectorAlternative[];
	/** Whether any alternative tests `:nth-child` / `:first-child`. */
	readonly needsChildIndex: boolean;
	/** Whether any alternative tests `:nth-of-type` / `:first-of-type`. */
	readonly needsTypeIndex: boolean;
}

/** {@link SelectorNegatedCompound} as the native conversion reads it: no tag is absent, not `null`. */
export interface NativeSelectorConditions {
	readonly tag?: string;
	readonly attributes: readonly SelectorAttributeTest[];
	readonly nth: readonly SelectorNthTest[];
}

/** {@link SelectorPlan} as the native conversion reads it (see `to-native-selector-plan.ts`). */
export interface NativeSelectorPlan {
	readonly alternatives: readonly {
		readonly compounds: readonly (NativeSelectorConditions & {
			readonly negations: readonly NativeSelectorConditions[];
		})[];
		readonly combinators: readonly SelectorCombinator[];
		readonly prefilterLiterals?: readonly string[];
		readonly direct: boolean;
	}[];
	readonly needsChildIndex: boolean;
	readonly needsTypeIndex: boolean;
}

/** The verdict on one document and which stages produced it. */
export interface HtmlMatchOutcome {
	/** Whether an element of the document matches the selector list. */
	readonly matched: boolean;
	/** The ordered-literal prefilter rejected the document; its markup was never read. */
	readonly prefiltered: boolean;
	/** The open-element stack ran over the document. */
	readonly tokenized: boolean;
	/** Elements the stack tested (zero when it did not run). */
	readonly elementsVisited: number;
}

/** One stored HTML snapshot as it sits in `page_html_blobs`. */
export interface StoredHtmlSnapshot {
	/** The stored bytes. */
	readonly body: Uint8Array;
	/** `page_html_blobs.codec`: `zstd` or `none`; anything else is rejected. */
	readonly codec: string;
}

/**
 * What `query search-html` looks for: a literal substring or a regular
 * expression (Rust `regex` syntax) with its flags.
 */
export interface NativeSearchPattern {
	/** The literal text, or the regular expression's source. */
	readonly source: string;
	/** Match `source` as plain text; the flags are then ignored. */
	readonly literal: boolean;
	/** `i`. */
	readonly ignoreCase: boolean;
	/** `m`: `^` and `$` match at every `\n`. */
	readonly multiLine: boolean;
	/** `s`: `.` matches `\n` too. */
	readonly dotAll: boolean;
}

/** What a search found in one document. */
export interface SnapshotSearchOutcome {
	/** Non-overlapping matches; 0 when the document does not match. */
	readonly matchCount: number;
	/** Whitespace-collapsed window around the first match; empty when there is none. */
	readonly snippet: string;
}

/** The verdict on one snapshot of a batch. */
export interface SnapshotMatchOutcome {
	readonly matched: boolean;
	/** The ordered-literal prefilter rejected the document; its markup was never read. */
	readonly prefiltered: boolean;
	/** The open-element stack ran over the document. */
	readonly tokenized: boolean;
}

/**
 * How a structural technology signal was found: a marker element or
 * attribute in the HTML, a framework's URL path fragment, a scoped-style
 * attribute convention, a marker too generic to count for much on its own,
 * or a license banner at the top of a JS file.
 */
export type StructuralTechnologySignalType =
	| 'html-marker'
	| 'url-pattern'
	| 'scoped-attr'
	| 'weak-marker'
	| 'js-license-comment';

/**
 * One structural fingerprint definition (in `crates/nitpicker_tech_detect`)
 * that matched, with the evidence cut from its first match.
 */
export interface StructuralTechnologySignal {
	/** Normalized technology name (`'Next.js'`, `'Vue'`, ...). */
	readonly technology: string;
	readonly signalType: StructuralTechnologySignalType;
	/** The first match, cut to 200 UTF-16 code units. */
	readonly evidence: string;
	/** The definition's confidence in isolation, 0-100. */
	readonly weight: number;
	/** The category attached to the technology when only this signal fired. */
	readonly category: string;
}

/**
 * The addon's run, which `createTemplateClassificationRun` wraps into a
 * {@link TemplateClassificationRun}; use that instead. Each computing call
 * resolves with the number of progress events it sent, which may still be on
 * their way to the callback (the wrapper waits for them). A panic in the
 * addon or a poisoned lock rejects the call with a generic failure; neither
 * can be provoked from JavaScript, so no test exercises them.
 * @example
 * ```ts
 * const native = new nativeBinding.TemplateClassificationRun();
 * native.pushSignals([{ paths: ['a'], stylesheetHrefs: [], stylesheetHosts: [] }]);
 * const sent = await native.block(); // 0
 * ```
 */
export interface NativeTemplateClassificationRun {
	/**
	 * {@link TemplateClassificationRun.pushSignals}, each stylesheet href's
	 * `new URL(href).host` (`null` where it throws) given alongside.
	 */
	pushSignals(signals: readonly NativeTemplatePageSignals[]): void;
	/** {@link TemplateClassificationRun.block}, resolving with the events sent. */
	block(): Promise<number>;
	/** {@link TemplateClassificationRun.pushPages}, resolving with the events sent. */
	pushPages(pages: readonly TemplatePageHtml[]): Promise<number>;
	/** {@link TemplateClassificationRun.finishPages}, resolving with the events sent. */
	finishPages(): Promise<number>;
	/** {@link TemplateClassificationRun.pageMask}; throws while a call runs. */
	pageMask(): Uint8Array;
	/** {@link TemplateClassificationRun.needsAssignment}; throws while a call runs. */
	needsAssignment(): boolean;
	/** {@link TemplateClassificationRun.pushAssignmentPages}, resolving with the events sent. */
	pushAssignmentPages(pages: readonly TemplatePageHtml[]): Promise<number>;
	/** {@link TemplateClassificationRun.takeOutput}, with the events sent. */
	takeOutput(): Promise<{
		readonly output: NativeTemplateClassificationOutput;
		readonly sent: number;
	}>;
	/** {@link TemplateClassificationRun.cancel}. */
	cancel(): void;
}

/**
 * {@link TemplatePageSignals} as the addon takes it.
 * @example
 * ```ts
 * const signals: NativeTemplatePageSignals = {
 * 	paths: ['news', '1'],
 * 	stylesheetHrefs: ['https://example.com/a.css', 'not a url'],
 * 	stylesheetHosts: ['example.com', null],
 * };
 * ```
 */
export interface NativeTemplatePageSignals {
	readonly paths: readonly string[];
	readonly stylesheetHrefs: readonly string[];
	/** `new URL(href).host` of each of `stylesheetHrefs`, `null` where it throws. */
	readonly stylesheetHosts: readonly (string | null)[];
	readonly host?: string;
}

/**
 * {@link TemplateClassificationProgress} as the addon reports it, every
 * field optional; `createTemplateClassificationRun` narrows it.
 * @example
 * ```ts
 * const event: NativeTemplateClassificationProgress = { phase: 'stage-b-start', unitCount: 42 };
 * ```
 */
export interface NativeTemplateClassificationProgress {
	readonly phase: string;
	readonly blockKey?: string;
	readonly blocksProcessed?: number;
	readonly totalBlocks?: number;
	readonly pagesAssigned?: number;
	readonly pagesToAssign?: number;
	readonly unitCount?: number;
	readonly pageCount?: number;
	readonly pairBytes?: number;
	readonly budget?: number;
	readonly reason?: string;
}

/**
 * {@link TemplateClassificationOutput} as the addon returns it: the reasons
 * flattened, which `createTemplateClassificationRun` turns into
 * {@link TemplateClusterReason}s.
 * @example
 * ```ts
 * const { keys, keyOfPage, reasons } = (await native.takeOutput()).output;
 * ```
 */
export interface NativeTemplateClassificationOutput {
	readonly keys: string[];
	readonly keyOfPage: Uint32Array;
	readonly reasons: readonly {
		readonly clusterKey: string;
		readonly memberCount: number;
		readonly blocking: readonly {
			readonly blockKey: string;
			readonly kind: string;
			readonly distinctiveStylesheetHrefs?: readonly string[];
			readonly pathKey?: string;
		}[];
		readonly structuralCoreTokens: readonly string[];
		readonly landmarks: readonly ({
			readonly type: string;
		} & TemplateLandmarkProfile)[];
		readonly siblingClusterKeys: readonly string[];
	}[];
	readonly sampledBlocks: readonly {
		readonly blockKey: string;
		readonly pageCount: number;
		readonly pairBytes: number;
		readonly reason: string;
	}[];
}

/**
 * The element a crawler reported as a page's main content: the element whose
 * subtree holds the page-specific content and under which the classifier
 * caps the nesting depth it compares. Every given field must match the same
 * element; empty strings and lists count as not given, and a hint with
 * nothing given matches nothing (otherwise the shallowest element of the
 * page would win and the cap would silently apply to the wrong node).
 *
 * A structured object rather than a CSS selector string: nothing has to be
 * parsed (the HTML parser already exposes `id`/`class`/`role`), it maps 1:1
 * onto the columns a crawler records for its detected main-content element,
 * and a crawler's own selector string is diagnostic (tag + id + classes) and
 * not guaranteed to be unique, so it is the wrong thing to re-parse.
 * @example
 * ```ts
 * const hint: ContentRootHint = { tagName: 'DIV', id: 'content', classList: ['l-main'] };
 * ```
 */
export interface ContentRootHint {
	/** Compared case-insensitively. */
	readonly tagName?: string;
	readonly id?: string;
	readonly role?: string;
	/** Every listed class must be on the element. */
	readonly classList?: readonly string[];
}

/**
 * What Pass 0 reads of one page handed to a
 * {@link TemplateClassificationRun}: no HTML, a few hundred bytes.
 * @example
 * ```ts
 * const signals: TemplatePageSignals = {
 * 	paths: ['news', '1'],
 * 	stylesheetHrefs: ['https://example.com/a.css'],
 * 	host: 'example.com',
 * };
 * ```
 */
export interface TemplatePageSignals {
	/** The page URL's path segments; a directory-style URL ends in `''`. */
	readonly paths: readonly string[];
	/** Absolute hrefs of the page's stylesheets, in document order. */
	readonly stylesheetHrefs: readonly string[];
	/**
	 * The page URL's host (`new URL(pageUrl).host`). Stylesheets on other
	 * hosts are left out of blocking; a page without it is judged against
	 * the host most pages load stylesheets from.
	 */
	readonly host?: string;
}

/**
 * One page's HTML handed to a {@link TemplateClassificationRun}.
 * @example
 * ```ts
 * const page: TemplatePageHtml = { html: '<body><main>…</main></body>', contentRoot: { tagName: 'main' } };
 * ```
 */
export interface TemplatePageHtml {
	readonly html: string;
	readonly contentRoot?: ContentRootHint;
}

/**
 * Progress of a {@link TemplateClassificationRun}: a block will be clustered
 * from a sample (over the memory budget, or among the largest when the
 * blocks clustered whole would hold too many pages), a block's clusters are done,
 * another thousand pages outside the samples were assigned, or the merge
 * across blocks began.
 * @example
 * ```ts
 * const onProgress = (event: TemplateClassificationProgress) => {
 * 	if (event.phase === 'pass1-block-complete') {
 * 		console.log(`${event.blocksProcessed}/${event.totalBlocks} blocks`);
 * 	}
 * };
 * ```
 */
export type TemplateClassificationProgress =
	| {
			readonly phase: 'block-sampled';
			readonly blockKey: string;
			readonly pageCount: number;
			readonly pairBytes: number;
			readonly budget: number;
			readonly reason: TemplateSampleReason;
	  }
	| {
			readonly phase: 'pass1-block-complete';
			readonly blockKey: string;
			readonly blocksProcessed: number;
			readonly totalBlocks: number;
	  }
	| {
			readonly phase: 'pass1b-assign';
			readonly pagesAssigned: number;
			readonly pagesToAssign: number;
	  }
	| { readonly phase: 'stage-b-start'; readonly unitCount: number };

/**
 * Why Pass 0 formed a block: its pages share a distinctive set of
 * stylesheets (`css`), or fall back to their URL section (`path`), or are
 * pages without stylesheets gathered into their section's stylesheet block
 * (`orphanMerge`).
 * @example
 * ```ts
 * const reason: TemplateBlockingReason = { kind: 'path', pathKey: 'news' };
 * ```
 */
export type TemplateBlockingReason =
	| { readonly kind: 'css'; readonly distinctiveStylesheetHrefs: readonly string[] }
	| { readonly kind: 'path'; readonly pathKey: string }
	| { readonly kind: 'orphanMerge'; readonly pathKey: string };

/**
 * A page region the classifier treats as chrome: HTML5 sectioning elements
 * and their ARIA landmark roles (`<header>` / `banner`, `<footer>` /
 * `contentinfo`, `<nav>` / `navigation`, `<aside>` / `complementary`,
 * `role="form"`, `<search>` / `search`). `main` is content and never one.
 * @example
 * ```ts
 * const type: TemplateLandmarkType = 'footer';
 * ```
 */
export type TemplateLandmarkType =
	| 'header'
	| 'footer'
	| 'nav'
	| 'aside'
	| 'form'
	| 'search';

/**
 * What `createTemplateClassificationRun`'s progress callback shares with the
 * run: the delivery counts, the waiting call, the run's failure, and the
 * addon's run only through a `WeakRef`. Kept apart from the run's methods so
 * the callback, which the addon holds while the run lives, does not hold the
 * run strongly.
 * @example
 * ```ts
 * const state: TemplateClassificationProgressState = {
 * 	delivered: 0,
 * 	expected: 0,
 * 	onDelivered: undefined,
 * 	failure: undefined,
 * 	nativeRef: undefined,
 * };
 * ```
 */
export interface TemplateClassificationProgressState {
	/** Events the callback received. */
	delivered: number;
	/** Events the finished calls said they sent. */
	expected: number;
	/** Wakes the call waiting for its events, if one is. */
	onDelivered: (() => void) | undefined;
	/** The error that failed the run, once one did. */
	failure: { readonly error: unknown } | undefined;
	/** The addon's run, to cancel when the caller's callback throws. */
	nativeRef: WeakRef<NativeTemplateClassificationRun> | undefined;
}

/**
 * How common one landmark type is across a cluster's member pages.
 * @example
 * ```ts
 * const footer: TemplateLandmarkProfile = {
 * 	presenceRate: 1,
 * 	chromeRate: 1,
 * 	shellTokens: ['footer>p'],
 * 	memberCountWithInstance: 12,
 * };
 * ```
 */
export interface TemplateLandmarkProfile {
	/** Fraction of the member pages carrying the type. */
	readonly presenceRate: number;
	/** Fraction of the type's instances that match the cluster's shell for it. */
	readonly chromeRate: number;
	/** The cluster's shell tokens for the type, in UTF-16 order. */
	readonly shellTokens: readonly string[];
	/** Member pages carrying the type. */
	readonly memberCountWithInstance: number;
}

/**
 * Why a final cluster's pages sit together: evidence, no verdicts. Its
 * shape — key order included — is what `@nitpicker/archive` stores as JSON,
 * so the stored bytes follow from it.
 * @example
 * ```ts
 * const reason: TemplateClusterReason = {
 * 	memberCount: 2,
 * 	blocking: [{ blockKey: 'path:news', reason: { kind: 'path', pathKey: 'news' } }],
 * 	structuralCoreTokens: ['article', 'body'],
 * 	landmarks: {},
 * 	siblingClusterKeys: [],
 * };
 * ```
 */
export interface TemplateClusterReason {
	/** Its member pages (the sampled ones, for a block clustered from a sample). */
	readonly memberCount: number;
	/** Each Pass-0 block it came from, with the reason the block was formed. */
	readonly blocking: readonly {
		readonly blockKey: string;
		readonly reason: TemplateBlockingReason;
	}[];
	/** The structure most of its pages share, in UTF-16 order. */
	readonly structuralCoreTokens: readonly string[];
	/** Per landmark type its members carry; absent types are left out. */
	readonly landmarks: {
		readonly [Type in TemplateLandmarkType]?: TemplateLandmarkProfile;
	};
	/** The other final clusters of its blocks, in UTF-16 order. */
	readonly siblingClusterKeys: readonly string[];
}

/**
 * Why a block is clustered from a sample of its pages: its Stage A
 * similarity table would exceed the memory budget (`table-over-budget`), or
 * the blocks clustered whole would hold more than
 * `TEMPLATE_EXACT_PAGE_LIMIT` pages and this one is among the largest
 * (`pages-over-limit`).
 * @example
 * ```ts
 * const reason: TemplateSampleReason = 'pages-over-limit';
 * ```
 */
export type TemplateSampleReason = 'table-over-budget' | 'pages-over-limit';

/**
 * A block clustered from a sample of its pages; see
 * {@link TemplateSampleReason} for why.
 * @example
 * ```ts
 * const block: TemplateSampledBlock = {
 * 	blockKey: 'path:news',
 * 	pageCount: 30_000,
 * 	pairBytes: 3_599_880_000,
 * 	reason: 'table-over-budget',
 * };
 * ```
 */
export interface TemplateSampledBlock {
	/** The block's key. */
	readonly blockKey: string;
	/** Its pages. */
	readonly pageCount: number;
	/** Bytes its similarity table would have taken. */
	readonly pairBytes: number;
	/** Why it was sampled. */
	readonly reason: TemplateSampleReason;
}

/**
 * What a {@link TemplateClassificationRun} produces.
 * @example
 * ```ts
 * const { keys, keyOfPage, reasons } = await run.takeOutput();
 * const keyOfFirstPage = keys[keyOfPage[0]!]!; // '["path:news","cluster:0"]'
 * reasons.get(keyOfFirstPage)?.memberCount;
 * ```
 */
export interface TemplateClassificationOutput {
	/** Every final cluster key (`JSON.stringify([blockKey, "cluster:N"])`). */
	readonly keys: string[];
	/** Each page's key, as an index into `keys`. */
	readonly keyOfPage: Uint32Array;
	/** Each final cluster's reason, by key. */
	readonly reasons: ReadonlyMap<string, TemplateClusterReason>;
	/** The blocks clustered from a sample, in block order; empty when none was. */
	readonly sampledBlocks: readonly TemplateSampledBlock[];
}

/**
 * One template classification run, executing on the addon's thread pool.
 * The caller reads the corpus: every page's signals (`pushSignals`), then
 * `block()`, then every page's HTML in the same order (`pushPages`,
 * `finishPages`), and, when `needsAssignment()`, once more
 * (`pushAssignmentPages`); `takeOutput()` merges and returns the result.
 *
 * Calls must not overlap: await each before the next (an overlapping call
 * rejects and leaves the running one alone). A promise resolves only after
 * every progress event of its call was delivered. A call that rejects —
 * cancelled, a protocol error, or `onProgress` threw (which also cancels the
 * run) — fails the run: every later call rejects with the same error, and no
 * further progress is reported.
 * @example
 * ```ts
 * const run = createTemplateClassificationRun();
 * run.pushSignals([{ paths: ['a'], stylesheetHrefs: [] }]);
 * await run.block();
 * await run.pushPages([{ html: '<body></body>' }]);
 * await run.finishPages();
 * const output = await run.takeOutput();
 * ```
 */
export interface TemplateClassificationRun {
	/** Adds the next pages' signals, in corpus order. */
	pushSignals(signals: readonly TemplatePageSignals[]): void;
	/** Splits the pages into blocks (Pass 0); the HTML reads follow. */
	block(): Promise<void>;
	/** Reads the next pages' HTML, in corpus order. */
	pushPages(pages: readonly TemplatePageHtml[]): Promise<void>;
	/** Ends the first read; the blocks clustered whole are clustered here. */
	finishPages(): Promise<void>;
	/**
	 * Which pages the current read uses (`1`): on the first read every page of
	 * a block clustered whole and the sampled pages of a sampled block, on the
	 * assignment read the other pages of the sampled blocks. Every page must
	 * still be pushed, in order; the others may carry empty HTML.
	 */
	pageMask(): Uint8Array;
	/**
	 * Whether the run expects the assignment read: true once the first
	 * read has ended with pages outside the samples of a sampled block, until
	 * the assignment read has ended; false otherwise.
	 */
	needsAssignment(): boolean;
	/** Assigns the next pages of the second read, in corpus order. */
	pushAssignmentPages(pages: readonly TemplatePageHtml[]): Promise<void>;
	/** Merges the clusters across blocks; the run cannot be used afterwards. */
	takeOutput(): Promise<TemplateClassificationOutput>;
	/**
	 * Makes the running call, and every later one, reject at its next page or
	 * block. A call already finished but waiting on its progress events
	 * resolves without them.
	 */
	cancel(): void;
}

/**
 * Inputs to `createTemplateClassificationRun`.
 * @example
 * ```ts
 * const options: CreateTemplateClassificationRunOptions = {
 * 	onProgress: (event) => console.log(event.phase),
 * };
 * ```
 */
export interface CreateTemplateClassificationRunOptions {
	/**
	 * Bytes a block's Stage A similarity table (`n * (n - 1) / 2 * 8` for `n`
	 * pages) may take before the block is clustered from a sample instead.
	 * Defaults to `TEMPLATE_MEMORY_BUDGET`; `0` samples every block.
	 */
	readonly memoryBudget?: number;
	/** Receives progress events. */
	readonly onProgress?: (event: TemplateClassificationProgress) => void;
}

/**
 * The addon's isolated-cluster run, which `createIsolatedClusterRun` wraps
 * into an {@link IsolatedClusterRun}; use that instead.
 * @example
 * ```ts
 * const native = new nativeBinding.IsolatedClusterRun(Uint32Array.of(1, 2), new Uint32Array());
 * native.unionEdges(Uint32Array.of(1, 2));
 * native.labels(); // Uint32Array [0, 0]
 * ```
 */
export interface NativeIsolatedClusterRun {
	/** {@link IsolatedClusterRun.unionEdges}, the pairs flattened. */
	unionEdges(edges: Uint32Array): void;
	/** {@link IsolatedClusterRun.labels}. */
	labels(): Uint32Array;
}

/**
 * The candidates {@link groupAliasCandidates} hands the addon, column by
 * column.
 * @example
 * ```ts
 * const columns: NativeAliasCandidates = {
 * 	urls: Buffer.from('https://example.com/'),
 * 	urlOffsets: Uint32Array.of(0, 20),
 * 	urlIds: Uint32Array.of(1),
 * 	titleTextIds: Uint32Array.of(1),
 * 	canonicalUrlIds: Uint32Array.of(4_294_967_295),
 * 	bodyHashes: new Uint8Array(),
 * 	hashOffsets: Uint32Array.of(0, 0),
 * 	hashPresent: Uint8Array.of(0),
 * };
 * ```
 */
export interface NativeAliasCandidates {
	/** The URLs back to back as UTF-8. */
	readonly urls: Uint8Array;
	/** `n + 1` positions cutting `urls` into the `n` URLs. */
	readonly urlOffsets: Uint32Array;
	readonly urlIds: Uint32Array;
	readonly titleTextIds: Uint32Array;
	/** `4294967295` for a page without a canonical. */
	readonly canonicalUrlIds: Uint32Array;
	/** The body hashes back to back. */
	readonly bodyHashes: Uint8Array;
	/** `n + 1` positions cutting `bodyHashes` into `n` pieces. */
	readonly hashOffsets: Uint32Array;
	/** `0` for a page without a body hash (its piece is empty). */
	readonly hashPresent: Uint8Array;
}

/**
 * The two keys under which pages are grouped as the same page under another
 * URL; see `computeAliasKeys`.
 * @example
 * ```ts
 * const keys: AliasKeys = { tierA: 'example.com/about/', tierB: 'example.com/about' };
 * ```
 */
export interface AliasKeys {
	/** Folds the scheme, the host's case and a trailing `/index.{ext}`. */
	readonly tierA: string;
	/** Tier A with one trailing `/` of the path dropped. */
	readonly tierB: string;
}

/**
 * One page that may be the same page as another under a different URL.
 * @example
 * ```ts
 * const page: AliasCandidate = {
 * 	url: 'https://example.com/about/',
 * 	urlId: 7,
 * 	titleTextId: 3,
 * 	canonicalUrlId: null,
 * 	bodyHash: null,
 * };
 * ```
 */
export interface AliasCandidate {
	/** The page's URL. */
	readonly url: string;
	/** `url_refs.id` of that URL. */
	readonly urlId: number;
	/** The id of the page's title text; pages with different titles never group. */
	readonly titleTextId: number;
	/** `url_refs.id` of the URL the page's `<link rel="canonical">` points at. */
	readonly canonicalUrlId: number | null;
	/** The page's body hash; without one the page groups by URL form only. */
	readonly bodyHash: Uint8Array | null;
}

/**
 * The connected components of the isolated pages, built from the pages' link
 * edges as they are read. Created by `createIsolatedClusterRun`.
 * @example
 * ```ts
 * const run = createIsolatedClusterRun([10, 20, 30], []);
 * run.unionEdges([10, 20]);
 * run.labels(); // Uint32Array [0, 0, 1]
 * ```
 */
export interface IsolatedClusterRun {
	/**
	 * Joins the pages of a batch of link edges, `[page, href, page, href, ...]`
	 * by page id, in any order and batch size. An edge counts when `page` is a
	 * candidate and `href`, once redirects and aliases are followed, is a
	 * different one.
	 */
	unionEdges(edges: ArrayLike<number>): void;
	/**
	 * For each candidate, in the order given, the number of its component,
	 * counted in order of first appearance.
	 */
	labels(): Uint32Array;
}

/**
 * Inputs to `loadNativeBinding`. Every field defaults to the running
 * process; tests override them to exercise other platforms.
 */
export interface LoadNativeBindingOptions {
	/** `process.platform` of the host. */
	readonly platform: NodeJS.Platform;
	/** `process.arch` of the host. */
	readonly arch: NodeJS.Architecture;
	/**
	 * glibc version of the running process (e.g. `"2.35"`), or `null` when the
	 * C library is not glibc (musl). Consulted only when `platform` is
	 * `linux`; when omitted there, it is read from Node's diagnostic report.
	 */
	readonly glibcVersion: string | null;
	/** Absolute path of the `@nitpicker/core` package directory. */
	readonly packageDir: string;
	/** Whether a file exists (`fs.existsSync`). */
	readonly fileExists: (filePath: string) => boolean;
	/** Loads a `.node` file or a package by specifier (`require`). */
	readonly requireModule: (specifier: string) => unknown;
}
