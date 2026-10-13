/**
 * The functions the native addon (`crates/nitpicker_napi`) exports, as seen
 * from JavaScript. Kept in sync with the `#[napi]` functions by hand — the
 * addon's own generated typings are not used, so every export goes through a
 * documented one-function-per-file wrapper instead.
 */
export interface NativeBinding {
	/** See `compute-body-hash.ts`. */
	computeBodyHash(html: Uint8Array): Buffer;
	/** See `template-stage-a-parity-probe.ts`. */
	templateStageAParityProbe(html: string, contentRoot?: ContentRootHint): string;
	/** See `create-template-stage-a-run.ts`. */
	TemplateStageARun: new (
		blockKeys: readonly string[],
		blockOfPage: Uint32Array,
		streaming: boolean,
		onProgress?: (event: NativeStageAProgress) => void,
	) => TemplateStageARun;
}

/**
 * The element a crawler reported as a page's main content. Every given
 * field must match the same element; empty strings and lists count as not
 * given, and a hint with nothing given matches nothing.
 */
export interface ContentRootHint {
	/** Compared case-insensitively. */
	readonly tagName?: string;
	readonly id?: string;
	readonly role?: string;
	/** Every listed class must be on the element. */
	readonly classList?: readonly string[];
}

/** One page handed to a {@link TemplateStageARun}. */
export interface StageAPage {
	readonly html: string;
	readonly contentRoot?: ContentRootHint;
}

/**
 * Progress of a {@link TemplateStageARun}: a block's Stage A finished, or
 * (streaming runs) another thousand pages outside the samples were
 * assigned.
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

/** {@link StageAProgress} as the addon reports it, every field optional. */
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

/** What a {@link TemplateStageARun} produces. */
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
 * thread pool. Calls must not overlap: await each before the next.
 */
export interface TemplateStageARun {
	/** Reads the next pages, in corpus order. */
	pushPages(pages: readonly StageAPage[]): Promise<void>;
	/** Ends the first read; an in-memory run clusters every block here. */
	finishPages(): Promise<void>;
	/** Whether a streaming run needs a second read to assign the pages outside its samples. */
	needsAssignment(): boolean;
	/** Assigns the next pages of the second read, in corpus order. */
	pushAssignmentPages(pages: readonly StageAPage[]): Promise<void>;
	/** The result; the run cannot be used afterwards. */
	takeOutput(): Promise<StageAOutput>;
	/** Makes the running call, and every later one, reject at its next page or block. */
	cancel(): void;
}

/** Inputs to `createTemplateStageARun`. */
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
