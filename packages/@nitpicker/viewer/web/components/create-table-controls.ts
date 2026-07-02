import type {
	TableColumnControls,
	TableFilterOption,
	TableSortOrder,
} from './paged-table.js';

interface UrlControlContext {
	params: URLSearchParams;
	updateMany: (
		updates: ReadonlyArray<readonly [key: string, value: string | readonly string[]]>,
	) => void;
}

/**
 * @param context
 * @example const controls = createTableControls({ params, updateMany });
 */
export function createTableControls(context: UrlControlContext): TableColumnControls {
	void context;
	return {
		sort: {},
		filter: {},
	};
}

/**
 * Keeps URL-backed sort controls consistent across views while allowing a view
 * to expose an implicit default sort without forcing that state into the URL.
 * @param controls
 * @param context
 * @param columnId
 * @param sortBy
 * @param defaultOrder - Used only when the URL has no explicit `sortBy`.
 * @example
 * addSort(controls, { params, updateMany }, 'url', 'url', 'asc');
 */
export function addSort(
	controls: TableColumnControls,
	context: UrlControlContext,
	columnId: string,
	sortBy: string,
	defaultOrder?: TableSortOrder,
) {
	controls.sort ??= {};
	const paramOrder = context.params.get('sortOrder');
	const sortOrder =
		paramOrder === 'asc' || paramOrder === 'desc' ? paramOrder : undefined;
	const active =
		context.params.get('sortBy') === sortBy ||
		(context.params.get('sortBy') == null && defaultOrder != null);
	controls.sort[columnId] = {
		active,
		order: sortOrder ?? (active ? defaultOrder : undefined),
		onChange: (next) => {
			context.updateMany([
				['sortBy', next ? sortBy : ''],
				['sortOrder', next ?? ''],
			]);
		},
	};
}

/**
 * Wires a free-form filter to a single query parameter so list state remains
 * shareable by URL instead of React component state.
 * @param controls
 * @param context
 * @param columnId
 * @param key
 * @param label
 * @example
 * addTextFilter(controls, context, 'url', 'urlPattern', 'URL pattern (%foo%)');
 */
export function addTextFilter(
	controls: TableColumnControls,
	context: UrlControlContext,
	columnId: string,
	key: string,
	label: string,
) {
	controls.filter ??= {};
	controls.filter[columnId] = {
		label,
		kind: 'text',
		value: context.params.get(key) ?? '',
		onApply: (next) => {
			context.updateMany([[key, typeof next === 'string' ? next : '']]);
		},
	};
}

/**
 * Represents single-choice enum filters as radios, including implicit defaults
 * such as the Pages view's internal-only scope.
 * @param controls
 * @param context
 * @param columnId
 * @param key
 * @param label
 * @param options
 * @param defaultValue - Selected value when the URL omits the filter key.
 * @example
 * addRadioFilter(controls, context, 'status', 'status', 'Status', [
 *   { value: '', label: 'All' },
 *   { value: '200', label: '200' },
 * ]);
 */
export function addRadioFilter(
	controls: TableColumnControls,
	context: UrlControlContext,
	columnId: string,
	key: string,
	label: string,
	options: TableFilterOption[],
	defaultValue = '',
) {
	controls.filter ??= {};
	const current =
		context.params.get(key) ??
		options.find((option) => option.checked)?.value ??
		defaultValue;
	controls.filter[columnId] = {
		label,
		kind: 'radio',
		options: options.map((option) => ({
			...option,
			checked: option.value === current,
		})),
		onApply: (next) => {
			context.updateMany([[key, typeof next === 'string' ? next : '']]);
		},
	};
}

/**
 * Stores multi-select filters as repeated query parameters so the server can
 * evaluate them as an AND-style filter without inventing a custom delimiter.
 * @param controls
 * @param context
 * @param columnId
 * @param key
 * @param label
 * @param options
 * @example
 * addChecklistFilter(controls, context, 'ruleIds', 'ruleId', 'Rules', [
 *   { value: 'heading-order', label: 'heading-order' },
 * ]);
 */
export function addChecklistFilter(
	controls: TableColumnControls,
	context: UrlControlContext,
	columnId: string,
	key: string,
	label: string,
	options: TableFilterOption[],
) {
	controls.filter ??= {};
	const current = new Set(context.params.getAll(key));
	controls.filter[columnId] = {
		label,
		kind: 'checklist',
		options: options.map((option) => ({
			...option,
			checked: current.has(option.value),
		})),
		onApply: (next) => {
			context.updateMany([[key, Array.isArray(next) ? next : []]]);
		},
	};
}
