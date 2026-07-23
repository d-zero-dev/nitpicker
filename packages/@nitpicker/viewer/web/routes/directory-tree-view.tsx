import type { DirectoryTreeNode } from '@nitpicker/query';

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { useDirectoryTree } from '../api/use-directory-tree.js';
import { DirectoryTree } from '../components/directory-tree.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Directory tree view: browse the crawled site by directory structure.
 * Fetches the initial (depth ≤ 3) tree per root host on load and expands
 * directories on demand via `useDirectoryTreeChildren`.
 *
 * Selecting a node navigates to `/pages?directory=<path>&contentTypeCategory=html`
 * rather than showing a page list in place — the Pages view's `directory`
 * filter (a SQL `LIKE` match) already covers the whole subtree with full
 * sort/filter/pagination for free, so there is no separate selection state
 * to track here. `contentTypeCategory=html` narrows the destination to HTML
 * documents — `directory` alone would also surface every non-HTML resource
 * (images, PDFs, …) crawled under that path, which "pages" should not imply.
 * @returns The directory tree view element.
 */
export function DirectoryTreeView() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { data, isLoading, isError, error } = useDirectoryTree();
	const [expandedOverrides, setExpandedOverrides] = useState<Map<number, boolean>>(
		() => new Map(),
	);

	const roots = useMemo(() => data?.roots ?? [], [data]);

	const toggle = useCallback((node: DirectoryTreeNode, isExpanded: boolean) => {
		setExpandedOverrides((prev) => {
			const next = new Map(prev);
			next.set(node.nodeId, !isExpanded);
			return next;
		});
	}, []);

	const select = useCallback(
		(node: DirectoryTreeNode) => {
			const query = new URLSearchParams({
				directory: node.path,
				contentTypeCategory: 'html',
			});
			void navigate(`/pages?${query.toString()}`);
		},
		[navigate],
	);

	return (
		<div className="view directory-tree-view">
			<ViewHeader
				titleKey="views.directoryTree.title"
				descriptionKey="views.directoryTree.description"
			/>
			{isLoading && <p>{t('common.loading')}</p>}
			{isError && <p role="alert">{error.message}</p>}
			{!isLoading && !isError && roots.length === 0 && (
				<p>{t('views.directoryTree.noRoots')}</p>
			)}
			<div className="directory-tree-pane">
				{roots.map((root) => (
					<DirectoryTree
						key={root.rootKey}
						root={root}
						expandedOverrides={expandedOverrides}
						onToggle={toggle}
						onSelect={select}
					/>
				))}
			</div>
		</div>
	);
}
