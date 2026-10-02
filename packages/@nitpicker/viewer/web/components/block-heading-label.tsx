import type { ClusterBlockGroup } from '../types.js';

import { getBlockingKindLabel } from '../i18n/get-blocking-kind-label.js';
import { useI18n } from '../i18n/use-i18n.js';

import { buildBlockHeadingItems } from './build-block-heading-items.js';
import { CodeList } from './code-list.js';

/** Props for {@link BlockHeadingLabel}. */
export interface BlockHeadingLabelProps {
	/** The block group to label. */
	group: ClusterBlockGroup;
	/**
	 * Show at most this many literals, then a "+N more" note — for a cell that
	 * points at the block's section rather than being its heading, where a
	 * css block keyed on a dozen stylesheets would otherwise swamp the row.
	 * Omit to show every literal.
	 */
	maxItems?: number;
}

/**
 * A block group's label: its kind in words (`Common stylesheets`, `URL
 * path`) followed by the literals the block was keyed on (stylesheet file
 * names or a directory) each in `<code>`. The block section's heading and
 * every cell that points at that section use this one rendering, so a reader
 * can find the section by scanning for the same words.
 * @param props - The block group, and optionally a cap on the literals shown.
 * @returns The inline label.
 * @example
 * <h3><BlockHeadingLabel group={group} /></h3>
 * <BlockHeadingLabel group={group} maxItems={2} />
 */
export function BlockHeadingLabel(props: BlockHeadingLabelProps) {
	const { t } = useI18n();
	const items = buildBlockHeadingItems(props.group);
	const shown = props.maxItems === undefined ? items : items.slice(0, props.maxItems);
	const hidden = items.length - shown.length;
	return (
		<>
			{getBlockingKindLabel(props.group.block.kind, t)}: <CodeList items={shown} />
			{hidden > 0 && (
				<>
					{' '}
					<small title={items.join(', ')}>
						{t('views.templateClusters.structuralCoreMore', { count: hidden })}
					</small>
				</>
			)}
		</>
	);
}
