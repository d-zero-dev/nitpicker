import { useI18n } from '../i18n/use-i18n.js';

import { GRAPH_COLORS } from './graph-colors.js';

/**
 * Static legend that maps the four graph node colors to their meaning.
 *
 * Without a legend the operator sees four hues on the canvas with no way
 * to decode them — the color-by-source feature is only useful if the
 * mapping is visible somewhere. Since the graph has no interactive
 * hover-tooltip on nodes today, the legend has to be a persistent
 * sibling of the canvas rather than an on-demand affordance.
 *
 * The rows are ordered by expected frequency (crawled first, errors
 * last) so an operator can find the common ones without hunting.
 * @returns The legend element.
 */
export function GraphLegend() {
	const { t } = useI18n();
	return (
		<ul className="graph-legend" aria-label={t('views.graph.legendLabel')}>
			<li className="graph-legend-row">
				<span
					className="graph-legend-swatch"
					style={{ backgroundColor: GRAPH_COLORS.crawled }}
					aria-hidden="true"
				/>
				{t('views.graph.legendCrawled')}
			</li>
			<li className="graph-legend-row">
				<span
					className="graph-legend-swatch"
					style={{ backgroundColor: GRAPH_COLORS.inventorySeed }}
					aria-hidden="true"
				/>
				{t('views.graph.legendInventorySeed')}
			</li>
			<li className="graph-legend-row">
				<span
					className="graph-legend-swatch"
					style={{ backgroundColor: GRAPH_COLORS.inventoryDiscovered }}
					aria-hidden="true"
				/>
				{t('views.graph.legendInventoryDiscovered')}
			</li>
			<li className="graph-legend-row">
				<span
					className="graph-legend-swatch"
					style={{ backgroundColor: GRAPH_COLORS.error }}
					aria-hidden="true"
				/>
				{t('views.graph.legendError')}
			</li>
		</ul>
	);
}
