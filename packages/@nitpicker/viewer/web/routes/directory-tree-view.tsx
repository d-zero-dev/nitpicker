import type { DirectoryTreeNode } from '@nitpicker/query';

import { useCallback, useMemo, useState } from 'react';

import { useDirectoryTree } from '../api/use-directory-tree.js';
import { DirectoryPagesPanel } from '../components/directory-pages-panel.js';
import { DirectoryTree } from '../components/directory-tree.js';
import { ViewHeader } from '../components/view-header.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Directory tree view: browse the crawled site by directory structure.
 * Fetches the initial (depth ≤ 3) tree per root host on load, expands
 * directories on demand via `useDirectoryTreeChildren`, and shows the
 * selected directory's direct pages in a side panel.
 *
 * The selected node is derived from two sources at render time — never via
 * an effect — because a node fetched dynamically beyond depth 3 only ever
 * exists in the tree's own `useDirectoryTreeChildren` results and cannot be
 * looked back up from an id alone:
 * - `dynamicSelectedNode`: the full node last passed to `onSelect` (covers
 *   every depth, including dynamically fetched ones).
 * - the initial depth ≤ 3 payload: used to resolve `?nodeId=` back to a
 *   node on first load/reload, when `dynamicSelectedNode` hasn't been set
 *   yet (or belongs to a different id, e.g. after a back-button navigation).
 *
 * `?nodeId=` is kept in the URL for shareability/back-button support; a
 * selection beyond depth 3 that isn't `dynamicSelectedNode` (e.g. after a
 * fresh reload) simply can't be resolved and starts unselected, rather than
 * erroring.
 * @returns The directory tree view element.
 */
export function DirectoryTreeView() {
	const { t } = useI18n();
	const { params, update } = useUrlFilter();
	const { data, isLoading, isError, error } = useDirectoryTree();
	const [expandedOverrides, setExpandedOverrides] = useState<Map<number, boolean>>(
		() => new Map(),
	);
	const [dynamicSelectedNode, setDynamicSelectedNode] =
		useState<DirectoryTreeNode | null>(null);

	const roots = useMemo(() => data?.roots ?? [], [data]);
	const nodeIdParam = params.get('nodeId');
	const selectedNodeId = nodeIdParam == null ? null : Number(nodeIdParam);

	const selectedNode = useMemo(() => {
		if (selectedNodeId == null) {
			return null;
		}
		if (dynamicSelectedNode?.nodeId === selectedNodeId) {
			return dynamicSelectedNode;
		}
		for (const root of roots) {
			const found = root.nodes.find((node) => node.nodeId === selectedNodeId);
			if (found) {
				return found;
			}
		}
		return null;
	}, [selectedNodeId, dynamicSelectedNode, roots]);

	const toggle = useCallback((node: DirectoryTreeNode, isExpanded: boolean) => {
		setExpandedOverrides((prev) => {
			const next = new Map(prev);
			next.set(node.nodeId, !isExpanded);
			return next;
		});
	}, []);

	const select = useCallback(
		(node: DirectoryTreeNode) => {
			setDynamicSelectedNode(node);
			update('nodeId', String(node.nodeId));
		},
		[update],
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
			<div className="directory-tree-layout">
				<div className="directory-tree-pane">
					{roots.map((root) => (
						<DirectoryTree
							key={root.rootKey}
							root={root}
							expandedOverrides={expandedOverrides}
							onToggle={toggle}
							selectedNodeId={selectedNode?.nodeId ?? null}
							onSelect={select}
						/>
					))}
				</div>
				<div className="directory-pages-pane">
					{selectedNode ? (
						<DirectoryPagesPanel node={selectedNode} />
					) : (
						<p>{t('views.directoryTree.noNodeSelected')}</p>
					)}
				</div>
			</div>
		</div>
	);
}
