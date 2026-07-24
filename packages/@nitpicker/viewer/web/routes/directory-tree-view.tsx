import type { DirectoryTreeSortOrder } from '../types.js';
import type { DirectoryTreeNode } from '@nitpicker/query';

import { INITIAL_DIRECTORY_TREE_DEPTH } from '@nitpicker/query/directory-tree-constants';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { useDirectoryTree } from '../api/use-directory-tree.js';
import { DirectoryTree } from '../components/directory-tree.js';
import { ViewHeader } from '../components/view-header.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

const DEPTH_PARAM = 'depth';
const SORT_PARAM = 'sort';
const EXPANDED_PARAM = 'expanded';
const COLLAPSED_PARAM = 'collapsed';

/**
 * Parses a comma-separated node-id URL param (e.g. `"3,7,12"`) into node
 * ids, silently dropping non-numeric entries — a hand-edited or stale URL
 * should degrade to "no override" for that entry rather than throw.
 * @param raw - The raw param value, or `null` if absent.
 * @returns The parsed node ids.
 */
function parseNodeIdList(raw: string | null): number[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map(Number)
		.filter((id) => Number.isInteger(id));
}

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
 *
 * Expand/collapse overrides, the collapse-depth threshold, and the sort
 * order all live in the URL (`?depth=`, `?sort=`, `?expanded=`,
 * `?collapsed=`) rather than local component state. Selecting a node
 * navigates away to the Pages view, which unmounts this component — a plain
 * `useState` would reset to its initial value on the back button. Every
 * other list view in this app (Pages, Isolated Clusters) stores its filter
 * state in the URL for the same reason, via {@link useUrlFilter}.
 *
 * The "collapse to depth" control resets every node back to the plain
 * `depth < N` default (see `DirectoryTreeNodeRow`'s `collapseDepthThreshold`
 * doc) by clearing `expanded`/`collapsed` entirely rather than trying to
 * compute which individual nodes to flip — a node beyond the initial depth ≤
 * `INITIAL_DIRECTORY_TREE_DEPTH` payload may not even be known to this
 * component yet (it lives in a descendant row's own `useDirectoryTreeChildren`
 * call), so there is no full node list here to iterate over in the first
 * place.
 * @returns The directory tree view element.
 */
export function DirectoryTreeView() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { data, isLoading, isError, error } = useDirectoryTree();
	const { params, update, updateMany } = useUrlFilter();

	const parsedDepth = Math.trunc(Number(params.get(DEPTH_PARAM)));
	const collapseDepthThreshold =
		Number.isInteger(parsedDepth) && parsedDepth >= 1
			? parsedDepth
			: INITIAL_DIRECTORY_TREE_DEPTH;

	const sortParamValue = params.get(SORT_PARAM);
	const sortOrder: DirectoryTreeSortOrder =
		sortParamValue === 'pagesDesc' || sortParamValue === 'pagesAsc'
			? sortParamValue
			: 'path';

	const expandedParamValue = params.get(EXPANDED_PARAM);
	const collapsedParamValue = params.get(COLLAPSED_PARAM);
	const expandedOverrides = useMemo(() => {
		const overrides = new Map<number, boolean>();
		for (const id of parseNodeIdList(expandedParamValue)) overrides.set(id, true);
		for (const id of parseNodeIdList(collapsedParamValue)) overrides.set(id, false);
		return overrides;
	}, [expandedParamValue, collapsedParamValue]);

	const [collapseDepthInput, setCollapseDepthInput] = useState(collapseDepthThreshold);
	const [sortOrderInput, setSortOrderInput] = useState<DirectoryTreeSortOrder>(sortOrder);

	const roots = useMemo(() => data?.roots ?? [], [data]);

	const toggle = useCallback(
		(node: DirectoryTreeNode, isExpanded: boolean) => {
			const nextExpanded = new Set(parseNodeIdList(params.get(EXPANDED_PARAM)));
			const nextCollapsed = new Set(parseNodeIdList(params.get(COLLAPSED_PARAM)));
			nextExpanded.delete(node.nodeId);
			nextCollapsed.delete(node.nodeId);
			if (isExpanded) {
				nextCollapsed.add(node.nodeId);
			} else {
				nextExpanded.add(node.nodeId);
			}
			updateMany(
				[
					[EXPANDED_PARAM, [...nextExpanded].map(String)],
					[COLLAPSED_PARAM, [...nextCollapsed].map(String)],
				],
				{ replace: true },
			);
		},
		[params, updateMany],
	);

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

	const collapseToDepth = useCallback(() => {
		updateMany([
			[DEPTH_PARAM, String(collapseDepthInput)],
			[EXPANDED_PARAM, []],
			[COLLAPSED_PARAM, []],
		]);
	}, [collapseDepthInput, updateMany]);

	const applySortOrder = useCallback(() => {
		update(SORT_PARAM, sortOrderInput === 'path' ? '' : sortOrderInput);
	}, [sortOrderInput, update]);

	return (
		<div className="view directory-tree-view">
			<ViewHeader
				titleKey="views.directoryTree.title"
				descriptionKey="views.directoryTree.description"
			/>
			<div className="tree-collapse-control">
				<label htmlFor="tree-collapse-depth-input">
					{t('views.directoryTree.collapseDepthInputLabel')}
				</label>
				<input
					id="tree-collapse-depth-input"
					type="number"
					min={1}
					step={1}
					value={collapseDepthInput}
					onChange={(event) => {
						const value = event.target.valueAsNumber;
						setCollapseDepthInput(
							Number.isNaN(value) ? 1 : Math.max(1, Math.trunc(value)),
						);
					}}
				/>
				<button type="button" className="tree-collapse-button" onClick={collapseToDepth}>
					{t('views.directoryTree.collapseToDepth')}
				</button>
			</div>
			<div className="tree-sort-control">
				<label htmlFor="tree-sort-order-select">
					{t('views.directoryTree.sortOrderLabel')}
				</label>
				<select
					id="tree-sort-order-select"
					value={sortOrderInput}
					onChange={(event) => {
						setSortOrderInput(event.target.value as DirectoryTreeSortOrder);
					}}>
					<option value="path">{t('views.directoryTree.sortOrderPath')}</option>
					<option value="pagesDesc">{t('views.directoryTree.sortOrderPagesDesc')}</option>
					<option value="pagesAsc">{t('views.directoryTree.sortOrderPagesAsc')}</option>
				</select>
				<button type="button" className="tree-sort-button" onClick={applySortOrder}>
					{t('views.directoryTree.applySortOrder')}
				</button>
			</div>
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
						collapseDepthThreshold={collapseDepthThreshold}
						sortOrder={sortOrder}
						onToggle={toggle}
						onSelect={select}
					/>
				))}
			</div>
		</div>
	);
}
