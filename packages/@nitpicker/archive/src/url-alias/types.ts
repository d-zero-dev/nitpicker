/**
 * Components a Tier A / Tier B alias key is built from. Used only by the
 * JavaScript alias-key implementation (`parse-alias-key-parts.ts`,
 * `format-alias-key.ts`), which is the parity oracle for the native keys and
 * is excluded from the build (`tsconfig.json`).
 */
export interface AliasKeyParts {
	host: string;
	port: string;
	path: string;
	search: string;
}
