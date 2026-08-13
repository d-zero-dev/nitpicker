import type { LinkProps } from 'react-router';

import { Link } from 'react-router';

/**
 * Props for {@link AppLink} — react-router's own `LinkProps`, forwarded
 * verbatim. A `type` alias, not an empty `interface extends`, because an
 * interface with no added members is flagged by
 * `@typescript-eslint/no-empty-object-type` (it's identical to its
 * supertype).
 */
export type AppLinkProps = LinkProps;

/**
 * Thin passthrough wrapper around react-router's `Link`, giving every
 * internal navigation link a single point of change for future look/behavior
 * tweaks (e.g. an external-link icon) without touching every call site.
 * @param props - Forwarded verbatim to `Link`.
 * @returns The link element.
 */
export function AppLink(props: AppLinkProps) {
	return <Link {...props} />;
}
