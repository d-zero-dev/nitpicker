/**
 * The functions the native addon (`crates/nitpicker_napi`) exports, as seen
 * from JavaScript. Kept in sync with the `#[napi]` functions by hand — the
 * addon's own generated typings are not used, so every export goes through a
 * documented one-function-per-file wrapper instead.
 */
export interface NativeBinding {
	/** See `compute-body-hash.ts`. */
	computeBodyHash(html: Uint8Array): Buffer;
	/** See `create-template-classification-run.ts`. */
	TemplateClassificationRun: new (
		onProgress?: (event: NativeTemplateClassificationProgress) => void,
	) => NativeTemplateClassificationRun;
	/** See `create-template-stage-a-run.ts`. */
	TemplateStageARun: new (
		blockKeys: readonly string[],
		blockOfPage: Uint32Array,
		streaming: boolean,
		onProgress?: (event: NativeStageAProgress) => void,
	) => NativeTemplateStageARun;
	/** See `template-block-sample-size.ts`. */
	TEMPLATE_BLOCK_SAMPLE_SIZE: number;
	/** See `template-corpus-inline-threshold.ts`. */
	TEMPLATE_CORPUS_INLINE_THRESHOLD: number;
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
 * Progress of a {@link TemplateClassificationRun}: a block's clusters are
 * done, (streaming runs) another thousand pages outside the samples were
 * assigned, or the merge across blocks began.
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
	/** Its member pages (the sampled ones, on a streaming run). */
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
	/** Ends the first read; an in-memory run clusters every block here. */
	finishPages(): Promise<void>;
	/**
	 * Which pages the current read uses (`1`): all of them in memory, the
	 * sampled ones on a streaming first read, the others on the assignment
	 * read. Every page must still be pushed, in order; the others may carry
	 * empty HTML.
	 */
	pageMask(): Uint8Array;
	/**
	 * Whether the run now expects the assignment read: true once a streaming
	 * first read has ended with pages outside the samples, until the
	 * assignment read has ended; false otherwise.
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
	/** Receives progress events. */
	readonly onProgress?: (event: TemplateClassificationProgress) => void;
}

/**
 * The addon's run, which `createTemplateStageARun` wraps into a
 * {@link TemplateStageARun}; use that instead. Each reading call resolves
 * with the number of progress events it sent, which may still be on their
 * way to the callback (the wrapper waits for them). A panic in the addon or
 * a poisoned lock rejects the call with a generic failure; neither can be
 * provoked from JavaScript, so no test exercises them.
 * @example
 * ```ts
 * const native = new nativeBinding.TemplateStageARun(['path:a'], Uint32Array.of(0), false);
 * const sent = await native.pushPages([{ html: '<body></body>' }]); // 0
 * ```
 */
export interface NativeTemplateStageARun {
	/** {@link TemplateStageARun.pushPages}, resolving with the events sent. */
	pushPages(pages: readonly StageAPage[]): Promise<number>;
	/** {@link TemplateStageARun.finishPages}, resolving with the events sent. */
	finishPages(): Promise<number>;
	/** {@link TemplateStageARun.pageMask}; throws while a call runs. */
	pageMask(): Uint8Array;
	/** {@link TemplateStageARun.needsAssignment}; throws while a call runs. */
	needsAssignment(): boolean;
	/** {@link TemplateStageARun.pushAssignmentPages}, resolving with the events sent. */
	pushAssignmentPages(pages: readonly StageAPage[]): Promise<number>;
	/** {@link TemplateStageARun.takeOutput}. */
	takeOutput(): Promise<StageAOutput>;
	/** {@link TemplateStageARun.cancel}. */
	cancel(): void;
}

/**
 * One page handed to a {@link TemplateStageARun}.
 * @example
 * ```ts
 * const page: StageAPage = { html: '<body><main>…</main></body>', contentRoot: { tagName: 'main' } };
 * ```
 */
export interface StageAPage {
	readonly html: string;
	readonly contentRoot?: ContentRootHint;
}

/**
 * Progress of a {@link TemplateStageARun}: a block's Stage A finished, or
 * (streaming runs) another thousand pages outside the samples were
 * assigned.
 * @example
 * ```ts
 * const onProgress = (event: StageAProgress) => {
 * 	if (event.phase === 'pass1-block-complete') {
 * 		console.log(`${event.blocksProcessed}/${event.totalBlocks} blocks`);
 * 	}
 * };
 * ```
 */
export type StageAProgress =
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
	  };

/**
 * {@link StageAProgress} as the addon reports it, every field optional;
 * `createTemplateStageARun` narrows it.
 * @example
 * ```ts
 * const event: NativeStageAProgress = { phase: 'pass1b-assign', pagesAssigned: 1000, pagesToAssign: 4200 };
 * ```
 */
export interface NativeStageAProgress {
	readonly phase: string;
	readonly blockKey?: string;
	readonly blocksProcessed?: number;
	readonly totalBlocks?: number;
	readonly pagesAssigned?: number;
	readonly pagesToAssign?: number;
}

/**
 * One Stage A cluster as Stage B merges it, its members' data in flat
 * arrays: member `m` owns
 * `memberTokens[memberTokenOffsets[m] .. memberTokenOffsets[m + 1]]` (its
 * compared token set, in insertion order) and the landmark instances
 * `memberInstanceOffsets[m] .. memberInstanceOffsets[m + 1]`; instance `i`
 * has type `instanceTypes[i]` (index into `header`, `footer`, `nav`,
 * `aside`, `form`, `search`) and tokens
 * `instanceTokens[instanceTokenOffsets[i] .. instanceTokenOffsets[i + 1]]`.
 * Token values index {@link StageAOutput.tokens}.
 * @example
 * ```ts
 * // The first member's compared tokens.
 * const tokens = [...unit.memberTokens.subarray(unit.memberTokenOffsets[0], unit.memberTokenOffsets[1])]
 * 	.map((token) => output.tokens[token]);
 * ```
 */
export interface StageAUnit {
	/** Index into {@link StageAOutput.keys}. */
	readonly key: number;
	/** Index into the run's block keys. */
	readonly block: number;
	readonly memberPageIndices: Uint32Array;
	readonly memberTokenOffsets: Uint32Array;
	readonly memberTokens: Uint32Array;
	readonly memberInstanceOffsets: Uint32Array;
	readonly instanceTypes: Uint8Array;
	readonly instanceTokenOffsets: Uint32Array;
	readonly instanceTokens: Uint32Array;
}

/**
 * What a {@link TemplateStageARun} produces.
 * @example
 * ```ts
 * const { keys, keyOfPage } = await run.takeOutput();
 * const keyOfFirstPage = keys[keyOfPage[0]!]; // '["path:news","cluster:0"]'
 * ```
 */
export interface StageAOutput {
	/** Every token the units mention, once each. */
	readonly tokens: string[];
	/** Every cluster key (`JSON.stringify([blockKey, "cluster:N"])`). */
	readonly keys: string[];
	/** Each page's cluster key, as an index into `keys`. */
	readonly keyOfPage: Uint32Array;
	/** In block order (streaming: in the order blocks completed). */
	readonly units: StageAUnit[];
}

/**
 * Stage A of one template classification run, executing on the addon's
 * thread pool. Calls must not overlap: await each before the next (an
 * overlapping call rejects and leaves the running one alone). A promise
 * resolves only after every progress event of its call was delivered.
 *
 * A call that rejects — cancelled, a protocol error, or `onProgress` threw
 * (which also cancels the run) — fails the run: every later call rejects
 * with the same error, and no further progress is reported.
 * @example
 * ```ts
 * const run = createTemplateStageARun({ blockKeys: ['path:a'], blockOfPage: Uint32Array.of(0), streaming: false });
 * await run.pushPages([{ html: '<body></body>' }]);
 * await run.finishPages();
 * const output = await run.takeOutput();
 * ```
 */
export interface TemplateStageARun {
	/** Reads the next pages, in corpus order. */
	pushPages(pages: readonly StageAPage[]): Promise<void>;
	/** Ends the first read; an in-memory run clusters every block here. */
	finishPages(): Promise<void>;
	/**
	 * Which pages the current read uses (`1`): all of them in memory, the
	 * sampled ones on a streaming first read, the others on the assignment
	 * read. Every page must still be pushed, in order; the others may carry
	 * empty HTML.
	 */
	pageMask(): Uint8Array;
	/**
	 * Whether the run now expects the assignment read: true once a streaming
	 * first read has ended with pages outside the samples, until the
	 * assignment read has ended; false otherwise.
	 */
	needsAssignment(): boolean;
	/** Assigns the next pages of the second read, in corpus order. */
	pushAssignmentPages(pages: readonly StageAPage[]): Promise<void>;
	/** The result; the run cannot be used afterwards. */
	takeOutput(): Promise<StageAOutput>;
	/**
	 * Makes the running call, and every later one, reject at its next page or
	 * block. A call already finished but waiting on its progress events
	 * resolves without them.
	 */
	cancel(): void;
}

/**
 * Inputs to `createTemplateStageARun`.
 * @example
 * ```ts
 * const options: CreateTemplateStageARunOptions = {
 * 	blockKeys: ['path:news', 'path:about'],
 * 	blockOfPage: Uint32Array.of(0, 0, 1),
 * 	streaming: false,
 * 	onProgress: (event) => console.log(event.phase),
 * };
 * ```
 */
export interface CreateTemplateStageARunOptions {
	/** The Pass-0 block keys, in the order their blocks are clustered. */
	readonly blockKeys: readonly string[];
	/** Page `i`'s index into `blockKeys`, for every page in corpus order. */
	readonly blockOfPage: Uint32Array;
	/**
	 * Cluster a bounded sample per block and assign the rest in a second
	 * read (corpora too large to hold), instead of holding every page.
	 */
	readonly streaming: boolean;
	/** Receives progress events. */
	readonly onProgress?: (event: StageAProgress) => void;
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
