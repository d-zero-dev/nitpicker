// Builds the native addon for the host platform and places it at the package
// root as `core.<platform>.node`, where `load-native-binding.ts` looks first.
//
// Plain `cargo build` + copy rather than `@napi-rs/cli`: the loader and the
// TypeScript wrappers are hand-written, so the CLI's remaining job would be
// exactly these two steps, and the release build runs inside a glibc 2.28
// container that has cargo but no Node toolchain to run the CLI with.
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Host platform → cargo output file name and the addon name the loader expects. */
const TARGETS = {
	'darwin-arm64': { library: 'libnitpicker_napi.dylib', addon: 'core.darwin-arm64.node' },
	'linux-x64': { library: 'libnitpicker_napi.so', addon: 'core.linux-x64-gnu.node' },
};

const target = TARGETS[`${process.platform}-${process.arch}`];
if (!target) {
	console.error(
		`@nitpicker/core: cannot build the native addon on ${process.platform}-${process.arch}. ` +
			'Supported build hosts: darwin-arm64, linux-x64 (glibc).',
	);
	process.exit(1);
}

const cargo = spawnSync(
	'cargo',
	['build', '--release', '--locked', '--package', 'nitpicker_napi'],
	{ cwd: packageDir, stdio: 'inherit' },
);
if (cargo.error) {
	console.error(
		'@nitpicker/core: failed to run cargo. Install the Rust toolchain (https://rustup.rs) — see CONTRIBUTING.md.',
	);
	throw cargo.error;
}
if (cargo.status !== 0) {
	process.exit(cargo.status ?? 1);
}

copyFileSync(
	path.join(packageDir, 'target', 'release', target.library),
	path.join(packageDir, target.addon),
);
