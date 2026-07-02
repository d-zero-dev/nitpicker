import { LinkListView } from './link-list-view.js';

/**
 * The broken-links view: anchors whose canonical destination resolves to
 * HTTP 404. Rendered via the user's chosen pagination mode.
 * @returns The broken-links view element.
 */
export function BrokenLinksView() {
	return (
		<LinkListView
			type="broken"
			titleKey="views.brokenLinks.title"
			descriptionKey="views.brokenLinks.description"
			i18nPrefix="views.brokenLinks"
		/>
	);
}
