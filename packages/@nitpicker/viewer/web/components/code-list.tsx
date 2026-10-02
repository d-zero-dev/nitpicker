import { Fragment } from 'react';

/** Props for {@link CodeList}. */
export interface CodeListProps {
	/** The literals to show, each in its own `<code>`. */
	items: readonly string[];
}

/**
 * Renders literal identifiers — file names, paths, keys — each in its own
 * `<code>`, separated by commas, so a machine value is never run into
 * prose and a path's slashes or a key's quotes read as data.
 * @param props - The literals to show.
 * @returns The inline `<code>` run.
 * @example
 * <CodeList items={['product.css', 'slick.css']} />
 */
export function CodeList(props: CodeListProps) {
	return (
		<>
			{props.items.map((item, index) => (
				<Fragment key={item}>
					{index > 0 && ', '}
					<code>{item}</code>
				</Fragment>
			))}
		</>
	);
}
