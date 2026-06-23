import type { NavItem } from '../types.js';

import { NavLink } from 'react-router';

import { useI18n } from '../i18n/use-i18n.js';

/** The sidebar navigation entries, one per view (labels resolved via i18n). */
const NAV_ITEMS: NavItem[] = [
	{ path: '/', labelKey: 'nav.summary' },
	{ path: '/pages', labelKey: 'nav.pages' },
	{ path: '/resources', labelKey: 'nav.resources' },
	{ path: '/images', labelKey: 'nav.images' },
	{ path: '/links', labelKey: 'nav.links' },
	{ path: '/page-links', labelKey: 'nav.pageLinks' },
	{ path: '/graph', labelKey: 'nav.graph' },
	{ path: '/violations', labelKey: 'nav.violations' },
	{ path: '/duplicates', labelKey: 'nav.duplicates' },
	{ path: '/mismatches', labelKey: 'nav.mismatches' },
	{ path: '/headers', labelKey: 'nav.headers' },
	{ path: '/errors', labelKey: 'nav.errors' },
	{ path: '/isolated-pages', labelKey: 'nav.isolatedPages' },
	{ path: '/isolated-clusters', labelKey: 'nav.isolatedClusters' },
	{ path: '/unused-resources', labelKey: 'nav.unusedResources' },
];

/**
 * The left navigation sidebar linking to each view.
 * @returns The sidebar element.
 */
export function NavSidebar() {
	const { t } = useI18n();
	return (
		<nav className="sidebar">
			<div className="sidebar-brand">Nitpicker</div>
			{NAV_ITEMS.map((item) => (
				<NavLink
					key={item.path}
					to={item.path}
					end={item.path === '/'}
					className={({ isActive }) =>
						isActive ? 'nav-link nav-link-active' : 'nav-link'
					}>
					{t(item.labelKey)}
				</NavLink>
			))}
		</nav>
	);
}
