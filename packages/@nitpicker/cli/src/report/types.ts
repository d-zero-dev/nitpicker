/**
 * Options for `resolveCredentialFilePath`.
 *
 * Both fields exist so tests can inject a sandbox instead of mutating
 * `process.env` / `process.cwd()`.
 */
export interface ResolveCredentialFilePathOptions {
	/** Directory searched for `credentials.json`. Defaults to `process.cwd()`. */
	readonly cwd: string;
	/** Environment to read `GOOGLE_AUTH_CREDENTIALS` from. Defaults to `process.env`. */
	readonly env: NodeJS.ProcessEnv;
}
