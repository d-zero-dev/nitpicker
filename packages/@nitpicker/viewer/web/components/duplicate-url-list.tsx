/** Props for {@link DuplicateUrlList}. */
export interface DuplicateUrlListProps {
	/** Sample of page URLs sharing the same duplicated field value. */
	urls: readonly string[];
}

/**
 * The sample URLs within one duplicate-value group, rendered as a bulleted,
 * word-broken list (shared `.url-list` styling with the Errors view).
 * @param props - The URLs to list.
 * @returns The list element, or `null` when there are no URLs.
 */
export function DuplicateUrlList(props: DuplicateUrlListProps) {
	if (props.urls.length === 0) {
		return null;
	}
	return (
		<ul className="url-list">
			{props.urls.map((url) => (
				<li key={url}>{url}</li>
			))}
		</ul>
	);
}
