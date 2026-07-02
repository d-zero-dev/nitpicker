import { LinkListView } from './link-list-view.js';

/**
 * The external-links view: anchors whose canonical destination leaves the
 * in-scope hostname. Rendered via the user's chosen pagination mode.
 * @returns The external-links view element.
 */
export function ExternalLinksView() {
	return (
		<LinkListView
			type="external"
			titleKey="views.externalLinks.title"
			descriptionKey="views.externalLinks.description"
			i18nPrefix="views.externalLinks"
		/>
	);
}
