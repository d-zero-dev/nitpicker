import type { DiffSegment } from '../types.js';

/** Props for {@link DiffCell}. */
export interface DiffCellProps {
	/** The diff segments to render. */
	segments: DiffSegment[];
}

/**
 * Renders text diff segments, highlighting removed parts in red and added
 * parts in green; common parts are shown plainly.
 * @param props - The segments to render.
 * @returns The diff cell element.
 */
export function DiffCell(props: DiffCellProps) {
	return (
		<span className="diff">
			{props.segments.map((segment, index) => {
				if (segment.type === 'common') {
					return <span key={index}>{segment.value}</span>;
				}
				return (
					<span
						key={index}
						className={segment.type === 'removed' ? 'diff-removed' : 'diff-added'}>
						{segment.value}
					</span>
				);
			})}
		</span>
	);
}
