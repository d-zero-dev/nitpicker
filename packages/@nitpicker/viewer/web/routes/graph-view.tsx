import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import Sigma from 'sigma';

import { useGraph } from '../api/use-graph.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/** Max rendered node radius (in-degree is mapped onto this). */
const MAX_NODE_SIZE = 18;

/** How long the force layout runs before settling (ms). */
const LAYOUT_DURATION = 3000;

/**
 * The Network Graph view: internal pages rendered as a force-directed graph
 * via sigma.js + graphology. Node size encodes in-degree; clicking a node
 * opens its detail page. Layout runs in a web worker to keep the UI responsive.
 * @returns The graph view element.
 */
export function GraphView() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { data, isLoading, error } = useGraph();
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !data) {
			return;
		}

		const graph = new Graph({ multi: false, type: 'directed' });
		for (const node of data.nodes) {
			graph.addNode(node.url, {
				label: node.url,
				size: Math.min(MAX_NODE_SIZE, 3 + Math.sqrt(node.inDegree)),
				x: Math.random(),
				y: Math.random(),
				color: node.status != null && node.status >= 400 ? '#ff6b6b' : '#4aa3ff',
			});
		}
		for (const edge of data.edges) {
			if (
				graph.hasNode(edge.source) &&
				graph.hasNode(edge.target) &&
				!graph.hasDirectedEdge(edge.source, edge.target)
			) {
				graph.addDirectedEdge(edge.source, edge.target);
			}
		}

		const layout = new FA2Layout(graph, {
			settings: forceAtlas2.inferSettings(graph),
		});
		layout.start();
		const stopTimer = globalThis.setTimeout(() => {
			layout.stop();
		}, LAYOUT_DURATION);

		const renderer = new Sigma(graph, container, {
			defaultEdgeType: 'arrow',
			renderEdgeLabels: false,
		});
		renderer.on('clickNode', ({ node }) => {
			void navigate(`/pages/detail?url=${encodeURIComponent(node)}`);
		});

		return () => {
			globalThis.clearTimeout(stopTimer);
			layout.kill();
			renderer.kill();
		};
	}, [data, navigate]);

	return (
		<div className="view">
			<ViewHeader titleKey="views.graph.title" descriptionKey="views.graph.description" />
			{isLoading && <div className="state">{t('common.loading')}</div>}
			{error && <div className="state state-error">{error.message}</div>}
			{data && (
				<div className="graph-meta">
					{t('views.graph.stats', { nodes: data.nodes.length, edges: data.edges.length })}
					{data.truncated && (
						<div className="state-warning">
							{t('views.graph.truncated', { nodes: data.nodes.length })}
						</div>
					)}
				</div>
			)}
			<div
				ref={containerRef}
				className="graph-canvas"
				role="img"
				aria-label={t('views.graph.ariaLabel')}
				aria-busy={isLoading}
			/>
		</div>
	);
}
