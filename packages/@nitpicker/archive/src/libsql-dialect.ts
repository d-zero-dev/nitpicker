import type { Knex } from 'knex';

// @ts-expect-error - Internal Knex subpath without published type declarations
import Client_BetterSQLite3 from 'knex/lib/dialects/better-sqlite3/index.js';
import libsql from 'libsql';

/**
 * Untyped reference to Knex's internal `better-sqlite3` dialect.
 *
 * Knex's published `exports` do not include this subpath, so TypeScript cannot
 * resolve a declaration file for it. The dialect is a concrete subclass of
 * `Knex.Client` at runtime, so the safe cast is intentional.
 */
const Base = Client_BetterSQLite3 as unknown as typeof Knex.Client;

/**
 * Knex dialect that reuses the `better-sqlite3` adapter logic but swaps the
 * underlying driver for `libsql`. `libsql` ships pre-compiled binaries via the
 * `@libsql/<platform>-<arch>` optionalDependencies pattern, so no postinstall
 * download from GitHub Releases is required.
 */
export class LibsqlDialect extends Base {
	/**
	 * Returns the `libsql` constructor as the SQLite driver.
	 *
	 * Typed as `unknown` to avoid leaking the `Libsql.DatabaseConstructor`
	 * namespace from a non-re-exported module across the public API surface.
	 */
	protected _driver(): unknown {
		return libsql;
	}
}
