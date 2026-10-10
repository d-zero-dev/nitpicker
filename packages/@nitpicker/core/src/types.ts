/**
 * The functions the native addon (`crates/nitpicker_napi`) exports, as seen
 * from JavaScript. Kept in sync with the `#[napi]` functions by hand — the
 * addon's own generated typings are not used, so every export goes through a
 * documented one-function-per-file wrapper instead.
 */
export interface NativeBinding {
	/** See `compute-body-hash.ts`. */
	computeBodyHash(html: Uint8Array): Buffer;
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
