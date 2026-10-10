import type { LoadNativeBindingOptions, NativeBinding } from './types.js';

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Oldest glibc the Linux addon is built against (the `manylinux_2_28`
 * release container). Matches the floor of Node.js 24's own Linux binaries,
 * so any Linux that can run a supported Node can load the addon.
 */
const MIN_GLIBC: readonly [number, number] = [2, 28];

const SUPPORTED_PLATFORMS_MESSAGE =
	'Supported platforms: darwin-arm64 (Apple silicon macOS), linux-x64 with glibc >= 2.28 (including WSL2).';

/**
 * Prebuilt addon for each supported host: the platform package that ships
 * it, and its file name (identical inside that package and at the
 * `@nitpicker/core` root, where a local `yarn build` puts it).
 */
const PLATFORM_ADDONS = {
	'darwin-arm64': {
		packageName: '@nitpicker/core-darwin-arm64',
		fileName: 'core.darwin-arm64.node',
	},
	'linux-x64': {
		packageName: '@nitpicker/core-linux-x64-gnu',
		fileName: 'core.linux-x64-gnu.node',
	},
} as const;

/**
 * Loads the native addon for the running platform.
 *
 * Looks for a locally built `core.<platform>.node` at the package root
 * first (a monorepo checkout after `yarn build`), then for the prebuilt
 * platform package installed through `optionalDependencies`. Prebuilt
 * binaries exist only for darwin-arm64 and linux-x64 (glibc), and there is
 * no JavaScript fallback, so any other platform fails here with the list of
 * supported ones instead of a bare `MODULE_NOT_FOUND`.
 *
 * Load errors of an addon that does exist (a corrupt or ABI-incompatible
 * file) are rethrown as-is rather than retried against the other location:
 * silently picking a different binary would hide the broken one.
 * @param options - Overrides for the host facts; omitted fields use the
 *   running process.
 * @returns The addon's exported functions.
 * @throws {Error} When the platform is unsupported or the platform package is
 *   not installed.
 * @example
 * ```ts
 * const binding = loadNativeBinding();
 * binding.computeBodyHash(Buffer.from('<body>x</body>'));
 * ```
 */
export function loadNativeBinding(
	options?: Partial<LoadNativeBindingOptions>,
): NativeBinding {
	const platform = options?.platform ?? process.platform;
	const arch = options?.arch ?? process.arch;
	const packageDir =
		options?.packageDir ??
		path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const fileExists = options?.fileExists ?? existsSync;
	const requireModule = options?.requireModule ?? createRequire(import.meta.url);

	const host = `${platform}-${arch}`;
	const addon =
		host in PLATFORM_ADDONS
			? PLATFORM_ADDONS[host as keyof typeof PLATFORM_ADDONS]
			: null;
	if (!addon) {
		throw new Error(
			`@nitpicker/core has no prebuilt native addon for ${host}. ${SUPPORTED_PLATFORMS_MESSAGE}`,
		);
	}
	if (platform === 'linux') {
		// Detected only here: building the diagnostic report costs startup time
		// that macOS (no libc choice) has no reason to pay.
		const glibcVersion =
			options?.glibcVersion === undefined ? detectGlibcVersion() : options.glibcVersion;
		if (glibcVersion === null) {
			throw new Error(
				`@nitpicker/core requires glibc on Linux, but this system uses another C library (e.g. musl). ${SUPPORTED_PLATFORMS_MESSAGE}`,
			);
		}
		if (!isAtLeast(glibcVersion, MIN_GLIBC)) {
			throw new Error(
				`@nitpicker/core requires glibc >= ${MIN_GLIBC.join('.')}, but this system has glibc ${glibcVersion}. ${SUPPORTED_PLATFORMS_MESSAGE}`,
			);
		}
	}

	const localBuild = path.join(packageDir, addon.fileName);
	if (fileExists(localBuild)) {
		return requireModule(localBuild) as NativeBinding;
	}
	try {
		return requireModule(addon.packageName) as NativeBinding;
	} catch (error) {
		// The same error covers a package that is absent and one that is present
		// without its binary (a source checkout before `yarn build`), so the
		// message names both fixes instead of guessing.
		if (isModuleNotFound(error, addon.packageName)) {
			throw new Error(
				`@nitpicker/core could not load its native addon from ${addon.packageName}: the package is not installed, or is installed without ${addon.fileName}. ` +
					'In a source checkout, run `yarn build` (it builds the addon locally). ' +
					'Otherwise reinstall without --no-optional / --omit=optional, which skip the platform package.',
				{ cause: error },
			);
		}
		throw error;
	}
}

/**
 * The glibc version the process runs against, read from Node's diagnostic
 * report header (absent under musl).
 *
 * Network interfaces are excluded from the report for the call — they are
 * the slow part of building it and irrelevant here — and the previous
 * setting is restored so the process's own diagnostic reports are unchanged.
 * @returns The glibc version string, or `null` when the C library is not glibc.
 */
function detectGlibcVersion(): string | null {
	// `excludeNetwork` exists at runtime on every supported Node (>= 24) but is
	// missing from the installed `@types/node`'s `ProcessReport`.
	const processReport = process.report as NodeJS.ProcessReport & {
		excludeNetwork: boolean;
	};
	const previous = processReport.excludeNetwork;
	processReport.excludeNetwork = true;
	try {
		const report = processReport.getReport() as {
			header?: { glibcVersionRuntime?: string };
		};
		return report.header?.glibcVersionRuntime ?? null;
	} finally {
		processReport.excludeNetwork = previous;
	}
}

/**
 * Compares a `major.minor` version numerically, so `2.9` is older than
 * `2.28` (a string comparison would say the opposite).
 * @param version - Version string such as `"2.35"`.
 * @param minimum - Required `[major, minor]`.
 * @returns Whether `version` is at least `minimum`.
 */
function isAtLeast(version: string, minimum: readonly [number, number]): boolean {
	const [minMajor, minMinor] = minimum;
	const [major = 0, minor = 0] = version.split('.').map(Number);
	return major > minMajor || (major === minMajor && minor >= minMinor);
}

/**
 * Whether `error` is Node's `MODULE_NOT_FOUND` for `specifier` itself, as
 * opposed to a module that `specifier` failed to load in turn.
 *
 * Only the first line is compared — the rest of the message is the require
 * stack, which names the platform package's own files when something inside
 * it is missing. That line names either the package itself (`Cannot find
 * module '<specifier>'`, not installed) or a path inside it (`Cannot find
 * module '…/<specifier>/core.….node'`, installed without its binary).
 * @param error - The value thrown by `require`.
 * @param specifier - The specifier that was required.
 * @returns `true` only for a not-found error whose first line names the
 *   package or its own `main` file.
 */
function isModuleNotFound(error: unknown, specifier: string): boolean {
	if (
		!(error instanceof Error) ||
		!('code' in error) ||
		error.code !== 'MODULE_NOT_FOUND'
	) {
		return false;
	}
	const [firstLine = ''] = error.message.split('\n');
	return firstLine.includes(`'${specifier}'`) || firstLine.includes(`/${specifier}/`);
}
