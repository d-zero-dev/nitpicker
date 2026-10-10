import type { LoadNativeBindingOptions } from './types.js';

import path from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { loadNativeBinding } from './load-native-binding.js';

const PACKAGE_DIR = '/pkg/core';
const FAKE_BINDING = { computeBodyHash: () => Buffer.alloc(32) };

/**
 * Host facts for a supported glibc Linux with nothing on disk; each test
 * overrides what it exercises.
 * @param overrides - Fields to replace.
 * @returns Complete loader options.
 */
function hostOptions(
	overrides: Partial<LoadNativeBindingOptions>,
): LoadNativeBindingOptions {
	return {
		platform: 'linux',
		arch: 'x64',
		glibcVersion: '2.35',
		packageDir: PACKAGE_DIR,
		fileExists: () => false,
		requireModule: () => FAKE_BINDING,
		...overrides,
	};
}

describe('loadNativeBinding', () => {
	it('prefers a locally built addon at the package root', () => {
		const requireModule = vi.fn(() => FAKE_BINDING);
		const binding = loadNativeBinding(
			hostOptions({
				platform: 'darwin',
				arch: 'arm64',
				glibcVersion: null,
				fileExists: (filePath) =>
					filePath === path.join(PACKAGE_DIR, 'core.darwin-arm64.node'),
				requireModule,
			}),
		);
		expect(binding).toBe(FAKE_BINDING);
		expect(requireModule).toHaveBeenCalledExactlyOnceWith(
			path.join(PACKAGE_DIR, 'core.darwin-arm64.node'),
		);
	});

	it('falls back to the platform package when there is no local build', () => {
		const requireModule = vi.fn(() => FAKE_BINDING);
		loadNativeBinding(hostOptions({ requireModule }));
		expect(requireModule).toHaveBeenCalledExactlyOnceWith(
			'@nitpicker/core-linux-x64-gnu',
		);
	});

	it('names the platform package and both fixes when it cannot be loaded', () => {
		const notFound = Object.assign(
			new Error("Cannot find module '@nitpicker/core-linux-x64-gnu'"),
			{ code: 'MODULE_NOT_FOUND' },
		);
		expect(() =>
			loadNativeBinding(
				hostOptions({
					requireModule: () => {
						throw notFound;
					},
				}),
			),
		).toThrow(
			'@nitpicker/core could not load its native addon from @nitpicker/core-linux-x64-gnu: the package is not installed, or is installed without core.linux-x64-gnu.node. In a source checkout, run `yarn build` (it builds the addon locally). Otherwise reinstall without --no-optional / --omit=optional, which skip the platform package.',
		);
	});

	it('treats a platform package without its binary like a missing one', () => {
		// What Node throws for a workspace-linked platform package before `yarn build`.
		const missingMain = Object.assign(
			new Error(
				'Cannot find module \'/repo/node_modules/@nitpicker/core-linux-x64-gnu/core.linux-x64-gnu.node\'. Please verify that the package.json has a valid "main" entry',
			),
			{ code: 'MODULE_NOT_FOUND' },
		);
		expect(() =>
			loadNativeBinding(
				hostOptions({
					requireModule: () => {
						throw missingMain;
					},
				}),
			),
		).toThrow(
			'@nitpicker/core could not load its native addon from @nitpicker/core-linux-x64-gnu',
		);
	});

	it('rethrows a not-found error raised inside the platform package', () => {
		// Node lists the requiring files after the first line, so the platform
		// package's name appears in the message without being the missing module.
		const transitive = Object.assign(
			new Error(
				"Cannot find module 'some-dependency'\nRequire stack:\n- /app/node_modules/@nitpicker/core-linux-x64-gnu/index.js",
			),
			{ code: 'MODULE_NOT_FOUND' },
		);
		expect(() =>
			loadNativeBinding(
				hostOptions({
					requireModule: () => {
						throw transitive;
					},
				}),
			),
		).toThrow(transitive);
	});

	it('rethrows load errors of an addon that exists', () => {
		const corrupt = new Error('dlopen failed: invalid ELF header');
		expect(() =>
			loadNativeBinding(
				hostOptions({
					fileExists: () => true,
					requireModule: () => {
						throw corrupt;
					},
				}),
			),
		).toThrow(corrupt);
	});

	it.each([
		['win32', 'x64'],
		['darwin', 'x64'],
		['linux', 'arm64'],
	] as const)('rejects %s-%s with the supported-platform list', (platform, arch) => {
		expect(() => loadNativeBinding(hostOptions({ platform, arch }))).toThrow(
			`@nitpicker/core has no prebuilt native addon for ${platform}-${arch}. Supported platforms: darwin-arm64 (Apple silicon macOS), linux-x64 with glibc >= 2.28 (including WSL2).`,
		);
	});

	it('rejects Linux without glibc', () => {
		expect(() => loadNativeBinding(hostOptions({ glibcVersion: null }))).toThrow(
			'@nitpicker/core requires glibc on Linux, but this system uses another C library (e.g. musl).',
		);
	});

	it('rejects Linux without glibc even when a local build exists', () => {
		const requireModule = vi.fn(() => FAKE_BINDING);
		expect(() =>
			loadNativeBinding(
				hostOptions({ glibcVersion: null, fileExists: () => true, requireModule }),
			),
		).toThrow('@nitpicker/core requires glibc on Linux');
		expect(requireModule).not.toHaveBeenCalled();
	});

	it.each(['2.17', '2.27', '2.9'])(
		'rejects glibc %s (older than 2.28)',
		(glibcVersion) => {
			expect(() => loadNativeBinding(hostOptions({ glibcVersion }))).toThrow(
				`@nitpicker/core requires glibc >= 2.28, but this system has glibc ${glibcVersion}.`,
			);
		},
	);

	it.each(['2.28', '2.39', '3.0'])('accepts glibc %s', (glibcVersion) => {
		expect(loadNativeBinding(hostOptions({ glibcVersion }))).toBe(FAKE_BINDING);
	});
});
