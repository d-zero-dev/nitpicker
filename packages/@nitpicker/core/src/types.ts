import type { Lanes } from '@d-zero/dealer';
import type { ExURL as URL } from '@d-zero/shared/parse-url';
import type { TableValue, Violation } from '@nitpicker/types';
import type { DOMWindow } from 'jsdom';

/**
 * Represents a single analyze plugin loaded from the user's configuration.
 *
 * Each plugin corresponds to an npm module that exports a {@link PluginFactory}
 * factory function as its default export. The `settings` object is passed
 * through to that factory at initialization time.
 * @see {@link ./load-plugin-settings.ts} for how plugins are discovered from cosmiconfig
 * @see {@link ./import-modules.ts} for how plugins are dynamically imported
 */
export interface Plugin {
	/**
	 * Human-readable plugin name. Currently unused at runtime but kept
	 * for backward compatibility with older config formats.
	 * @deprecated Use `module` to identify plugins instead.
	 */
	name: string;

	/**
	 * The npm module specifier to `import()` (e.g. `"@nitpicker/analyze-axe"`).
	 */
	module: string;

	/**
	 * Absolute path to the configuration file where this plugin was declared.
	 * Passed to the plugin so it can resolve relative paths in its own config.
	 */
	configFilePath: string;

	/**
	 * Plugin-specific settings object parsed from the config file.
	 * The shape is determined by the plugin itself (e.g. `{ lang: "ja" }` for axe).
	 */
	settings?: unknown;
}

/**
 * Options for {@link ../nitpicker.ts!Nitpicker.analyze}.
 *
 * Allows callers to provide an external {@link https://www.npmjs.com/package/@d-zero/dealer | Lanes}
 * instance for rich progress display, and a verbose flag for non-TTY environments.
 */
export interface AnalyzeOptions {
	/** Lanes instance for per-plugin progress display. If omitted, no progress is shown. */
	readonly lanes?: Lanes;

	/** When `true`, outputs plain-text progress lines instead of animated Lanes. */
	readonly verbose?: boolean;
}

/**
 * Internal configuration model used by {@link ../nitpicker.ts!Nitpicker}.
 *
 * Built by {@link ./load-plugin-settings.ts!loadPluginSettings} from the
 * user's cosmiconfig file (e.g. `.nitpickerrc.json`). The external config
 * format (`ConfigJSON` from `@nitpicker/types`) uses a `plugins.analyze`
 * object keyed by module name; this internal type normalizes it into an
 * ordered array of fully-resolved {@link Plugin} entries.
 */
export interface Config {
	/** Ordered list of analyze plugins to execute. */
	analyze: Plugin[];
}

/**
 * The runtime interface that every analyze plugin must satisfy after
 * its factory function ({@link PluginFactory}) has been invoked.
 *
 * A plugin may implement one or both callback methods:
 *
 * - **`eachPage`** - Runs inside a Worker thread with full JSDOM access.
 *   Best for DOM-dependent analysis (markup validation, text linting,
 *   accessibility checks). Each invocation receives a parsed `DOMWindow`,
 *   so plugins can use standard DOM APIs without additional parsing.
 *
 * - **`eachUrl`** - Runs in the main thread, receives only the URL and
 *   external/internal flag. Suited for lightweight, network-based checks
 *   (e.g. link validation, SEO URL pattern checks).
 * @template T - String literal union of the column keys this plugin
 *   contributes to the report table (e.g. `'title' | 'description'`).
 * @see {@link ./page-analysis-worker.ts} for how `eachPage` is called inside the worker
 * @see {@link ./nitpicker.ts} for how `eachUrl` is called from the main thread
 */
export interface AnalyzePlugin<T extends string = string> {
	/**
	 * Human-readable display label for interactive prompts.
	 * Shown instead of the raw package name (e.g. `"axe: アクセシビリティチェック"`).
	 */
	label?: string;

	/**
	 * Column header definitions contributed by this plugin.
	 * Keys are column identifiers (`T`), values are human-readable labels
	 * shown in the report header row.
	 */
	headers?: TableHeaders<T>;

	/**
	 * Per-page analysis callback executed in a Worker thread.
	 * @param page - Context for the current page, including the raw HTML,
	 *   a live JSDOM window, the page URL, and progress counters.
	 * @param page.url - Parsed URL of the page being analyzed.
	 * @param page.html - Raw HTML string of the page.
	 * @param page.window - JSDOM window with the page's DOM tree. Closed after the callback returns.
	 * @param page.num - Zero-based index of the current page in the batch.
	 * @param page.total - Total number of pages in the batch.
	 * @returns Report data for this page, or `null` to skip.
	 */
	eachPage?(page: {
		/** Parsed URL of the page being analyzed. */
		url: URL;
		/** Raw HTML string of the page. */
		html: string;
		/** JSDOM window with the page's DOM tree. Closed after the callback returns. */
		window: DOMWindow;
		/** Zero-based index of the current page in the batch. */
		num: number;
		/** Total number of pages in the batch. */
		total: number;
	}): Promise<ReportPage<T> | null> | ReportPage<T> | null;

	/**
	 * Per-URL analysis callback executed in the main thread.
	 *
	 * Unlike `eachPage`, this callback does **not** receive HTML or a DOM
	 * window. It is designed for checks that depend only on URL metadata
	 * (e.g. checking URL patterns, external link policies).
	 * @param page - URL context including external/internal classification.
	 * @param page.url - Parsed URL being analyzed.
	 * @param page.isExternal - Whether this URL is external to the crawled site.
	 * @returns Report data for this URL, or `null` to skip.
	 */
	eachUrl?(page: {
		/** Parsed URL being analyzed. */
		url: URL;
		/** Whether this URL is external to the crawled site. */
		isExternal: boolean;
	}): Promise<ReportPage<T> | null> | ReportPage<T> | null;
}

/**
 * The return value of a single {@link AnalyzePlugin.eachPage} or {@link AnalyzePlugin.eachUrl}
 * invocation for one page/URL.
 *
 * A plugin can contribute tabular data (displayed in spreadsheet columns)
 * and/or violation records (displayed in a dedicated violations sheet).
 * @template T - Column key union matching the plugin's `headers`.
 */
export interface ReportPage<T extends string> {
	/** Column data for this page. Keys must be a subset of `T`. */
	page?: TableData<T>;
	/** Violations detected on this page (e.g. a11y issues, lint errors). */
	violations?: Violation[];
}

/**
 * Aggregated report data from a Worker thread, keyed by page URL.
 *
 * This is the message payload returned from the Worker to the main thread
 * via the `'finish'` message. It aggregates results from all plugins that
 * ran `eachPage` for a single page.
 * @template T - Column key union.
 * @see {@link ./page-analysis-worker.ts} for the Worker entry point that produces this
 * @see {@link ./worker/run-in-worker.ts!runInWorker} for the main-thread consumer
 */
export interface ReportPages<T extends string> {
	/** Per-URL table data from all plugins. */
	pages?: TablePages<T>;
	/** Combined violations from all plugins. */
	violations?: Violation[];
}

/**
 * Factory function signature that every analyze plugin module must
 * export as its default export.
 *
 * The factory receives the user's settings object (`O`) and returns
 * an {@link AnalyzePlugin} instance (or a Promise thereof). This two-phase
 * pattern allows plugins to perform async initialization (e.g.
 * loading locale files, compiling lint configs) once, then reuse
 * the resulting plugin for every page.
 *
 * Use {@link ./hooks/define-plugin.ts!definePlugin} to define a
 * plugin with full type inference.
 * @template O - Shape of the plugin's settings from the config file.
 * @template T - String literal union of column keys the plugin contributes.
 * @example
 * ```ts
 * // In @nitpicker/analyze-search/src/index.ts
 * import { definePlugin } from '@nitpicker/core';
 *
 * type Options = { keywords: string[] };
 *
 * export default definePlugin(async (options: Options) => {
 *   return {
 *     headers: { found: 'Keywords Found' },
 *     async eachPage({ html }) {
 *       const count = options.keywords.filter(k => html.includes(k)).length;
 *       return { page: { found: { value: count } } };
 *     },
 *   };
 * });
 * ```
 * @see {@link AnalyzePlugin} for the runtime interface
 * @see {@link ./hooks/define-plugin.ts!definePlugin} for the type-safe wrapper
 */
export type PluginFactory<O, T extends string = string> = (
	options: O,
	configFilePath: string,
) => Promise<AnalyzePlugin<T>> | AnalyzePlugin<T>;

/**
 * Column header definitions: maps column key to display label.
 * @example
 * ```ts
 * const headers: TableHeaders<'title' | 'desc'> = {
 *   title: 'Page Title',
 *   desc: 'Meta Description',
 * };
 * ```
 */
export type TableHeaders<K extends string> = Record<K, string>;

/** Internal Map representation of {@link TableHeaders}, used by {@link ../table.ts!Table}. */
export type TableHeaderMap<K extends string> = Map<K, string>;

/** A single row of cell values keyed by column identifier. */
export type TableData<K extends string> = Record<K, TableValue>;

/**
 * Multiple rows of table data keyed by page URL.
 * This is the serialized form used in Worker message payloads and JSON output.
 */
export type TablePages<K extends string> = Record<string, TableData<K>>;

/**
 * Internal Map representation of page-keyed table data.
 * Used by {@link ../table.ts!Table} for efficient merge operations.
 */
export type TableRow<K extends string> = Map<string, TableData<K>>;

/**
 * Payload for starting an analyze action.
 * @internal
 */
export interface PluginExecutionContext {
	/** Human-readable name of the plugin module. */
	pluginModuleName: string;
	/** Resolved file system path to the plugin module. */
	pluginModulePath: string;
	/** Plugin-specific settings to pass to the hook factory. */
	settings: unknown;
	/** Path to the config file where this action was declared. */
	configFilePath: string;
	/** Temporary directory where the archive is extracted. */
	archiveTempDir: string;
	/** Full resolved configuration. */
	config: Config;
}

/**
 * Event map for the {@link ../nitpicker.ts!Nitpicker} event emitter.
 *
 * Consumers can listen to these events via `nitpicker.on('writeFile', ...)`.
 * @see {@link ../nitpicker.ts!Nitpicker} which extends `TypedAwaitEventEmitter<NitpickerEvent>`
 */
export interface NitpickerEvent {
	/**
	 * Emitted after the archive file has been successfully written to disk.
	 */
	writeFile: {
		/** Absolute path to the written `.nitpicker` archive file. */
		filePath: string;
	};

	/**
	 * Emitted when a non-fatal error occurs during analysis.
	 */
	error: {
		/** Human-readable error description. */
		message: string;
		/** Original Error object, or `null` if unavailable. */
		error: Error | null;
	};
}
