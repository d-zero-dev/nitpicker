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
	const glibcVersion =
		options?.glibcVersion === undefined ? detectGlibcVersion() : options.glibcVersion;
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
		if (isModuleNotFound(error, addon.packageName)) {
			throw new Error(
				`@nitpicker/core could not find its native addon: ${addon.packageName} is not installed. ` +
					'It is an optional dependency; reinstall without --no-optional / --omit=optional.',
				{ cause: error },
			);
		}
		throw error;
	}
}

/**
 * The glibc version the process runs against, read from Node's diagnostic
 * report header (absent under musl and on non-Linux platforms).
 */
function detectGlibcVersion(): string | null {
	const report = process.report.getReport() as {
		header?: { glibcVersionRuntime?: string };
	};
	return report.header?.glibcVersionRuntime ?? null;
}

/**
 *
 * @param version
 * @param root0
 * @param root0."0"
 * @param root0."1"
 */
function isAtLeast(
	version: string,
	[minMajor, minMinor]: readonly [number, number],
): boolean {
	const [major = 0, minor = 0] = version.split('.').map(Number);
	return major > minMajor || (major === minMajor && minor >= minMinor);
}

/**
 *
 * @param error
 * @param specifier
 */
function isModuleNotFound(error: unknown, specifier: string): boolean {
	return (
		error instanceof Error &&
		'code' in error &&
		error.code === 'MODULE_NOT_FOUND' &&
		error.message.includes(specifier)
	);
}
