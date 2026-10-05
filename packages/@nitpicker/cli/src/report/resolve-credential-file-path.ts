import type { ResolveCredentialFilePathOptions } from './types.js';

import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve the Google credential file path for `report --sheet` / `pipeline --sheet`.
 *
 * Resolution order (first hit wins):
 *
 * 1. `explicitPath` (the `--credentials` flag)
 * 2. `GOOGLE_AUTH_CREDENTIALS` environment variable
 * 3. `<cwd>/credentials.json`, only when the file exists
 * 4. `undefined`, which makes `@d-zero/google-auth` fall back to
 *    Application Default Credentials
 *
 * The credential format (OAuth2 Desktop, service account, authorized user) is
 * detected by `@d-zero/google-auth` from the file contents, not here.
 *
 * Why the environment is read here even though `@d-zero/google-auth` also
 * reads it: step 3 must rank below the environment variable, so passing an
 * existing `./credentials.json` down would otherwise shadow it. Why the
 * `--credentials` flag has no `default`: `@d-zero/roar` would always fill it,
 * making steps 2 and 4 unreachable.
 *
 * Empty strings count as unset. An environment path is returned as is, without
 * an existence check, so a wrong path fails loudly in `@d-zero/google-auth`
 * instead of silently switching to another credential.
 * @param explicitPath - Value of `--credentials`, if given.
 * @param options - Overrides for the working directory and environment.
 * @returns The path to pass to `authentication()`, or `undefined` to use ADC.
 * @example
 * ```ts
 * resolveCredentialFilePath('./sa.json'); // './sa.json'
 * resolveCredentialFilePath(undefined, {
 * 	env: { GOOGLE_AUTH_CREDENTIALS: '/run/secrets/google.json' },
 * }); // '/run/secrets/google.json'
 * resolveCredentialFilePath(undefined, { cwd: '/empty', env: {} }); // undefined
 * ```
 */
export function resolveCredentialFilePath(
	explicitPath: string | undefined,
	options?: Partial<ResolveCredentialFilePathOptions>,
): string | undefined {
	if (explicitPath) {
		return explicitPath;
	}

	const env = options?.env ?? process.env;
	const envPath = env.GOOGLE_AUTH_CREDENTIALS;
	if (envPath) {
		return envPath;
	}

	const localPath = path.resolve(options?.cwd ?? process.cwd(), 'credentials.json');
	if (existsSync(localPath)) {
		return localPath;
	}

	return undefined;
}
