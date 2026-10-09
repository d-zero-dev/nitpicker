import type { Config } from '../../types.js';
import type { Knex } from 'knex';

/**
 * Retrieves the working directory recorded when this stub's crawl session
 * was created, so {@link import('../../archive.js').default.resume} can
 * reconstruct the completed archive's output path independent of the
 * directory `crawl --resume` happens to be invoked from.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns The recorded cwd, or `null` for a stub created before this column
 *   existed (or created by a code path that never stamps it, i.e. `resume`).
 */
export async function getCreatedCwd(knex: Knex): Promise<string | null> {
	const [row] = await knex.select('createdCwd').from<Config>('info');
	return row?.createdCwd ?? null;
}
