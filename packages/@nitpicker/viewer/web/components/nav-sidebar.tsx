import type { NavItem } from '../types.js';

import { NavLink } from 'react-router';

import { useI18n } from '../i18n/use-i18n.js';

/** The sidebar navigation entries, one per view (labels resolved via i18n). */
const NAV_ITEMS: NavItem[] = [
	{ path: '/', labelKey: 'nav.summary' },
	{ path: '/pages', labelKey: 'nav.pages' },
	{ path: '/template-clusters', labelKey: 'nav.templateClusters' },
	{ path: '/directory-tree', labelKey: 'nav.directoryTree' },
	{ path: '/resources', labelKey: 'nav.resources' },
	{ path: '/images', labelKey: 'nav.images' },
	{ path: '/broken-links', labelKey: 'nav.brokenLinks' },
	{ path: '/external-links', labelKey: 'nav.externalLinks' },
	{ path: '/graph', labelKey: 'nav.graph' },
	{ path: '/violations', labelKey: 'nav.violations' },
	{ path: '/duplicates', labelKey: 'nav.duplicates' },
	{ path: '/mismatches', labelKey: 'nav.mismatches' },
	{ path: '/errors', labelKey: 'nav.errors' },
	{ path: '/isolated-pages', labelKey: 'nav.isolatedPages' },
	{ path: '/isolated-clusters', labelKey: 'nav.isolatedClusters' },
	{ path: '/unused-resources', labelKey: 'nav.unusedResources' },
	{ path: '/console-logs', labelKey: 'nav.consoleLogs' },
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
