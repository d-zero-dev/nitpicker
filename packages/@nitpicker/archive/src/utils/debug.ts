import debug from 'debug';

/**
 * Debug logger for the archive layer's shared utilities. Namespace:
 * `Nitpicker:Utils` — the same namespace as `@nitpicker/crawler`'s utility
 * logger, so one `DEBUG=Nitpicker:Utils*` filter covers both packages
 * (`../debug.ts` extends it to `Nitpicker:Utils:Archive`).
 */
export const log = debug('Nitpicker:Utils');
