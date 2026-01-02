import type { ProductionNode } from "@/types";
import { MarkerType, type Edge } from "@xyflow/react";

/**
 * Creates a stable key for a ProductionNode.
 *
 * This key is used to identify unique production steps across the dependency tree,
 * allowing proper merging or aggregation of identical nodes.
 *
 * @param node The ProductionNode to create a key for
 * @returns A unique string key for the node
 */
export const createFlowNodeKey = (node: ProductionNode): string => {
  const itemId = node.item.id;
  const recipeId = node.recipe?.id ?? "raw";
  const rawFlag = node.isRawMaterial ? "raw" : "prod";
  return `${itemId}__${recipeId}__${rawFlag}`;
};

/**
 * Aggregated production node data.
 * Combines multiple occurrences of the same production step.
 */
export type AggregatedProductionNodeData = {
  /** Representative ProductionNode (from first encounter) */
  node: ProductionNode;
  /** Total production rate across all branches */
  totalRate: number;
  /** Total facility count across all branches */
  totalFacilityCount: number;
};

/**
 * Collects all unique production nodes from the dependency tree and aggregates their requirements.
 *
 * Traverses the tree and deduplicates nodes based on their key,
 * while summing up rates and facility counts for nodes that appear in multiple branches.
 *
 * @param rootNodes Root nodes of the dependency tree
 * @returns Map of node keys to their aggregated production data
 */
export function aggregateProductionNodes(
  rootNodes: ProductionNode[],
): Map<string, AggregatedProductionNodeData> {
  const nodeMap = new Map<string, AggregatedProductionNodeData>();

  const collect = (node: ProductionNode) => {
    // Skip cycle placeholders - they don't represent actual production
    if (node.isCyclePlaceholder) {
      // Still traverse their dependencies (though they should have none)
      node.dependencies.forEach(collect);
      return;
    }

    const key = createFlowNodeKey(node);
    const existing = nodeMap.get(key);

    if (existing) {
      // Aggregate rates and facility counts from multiple occurrences
      existing.totalRate += node.targetRate;
      existing.totalFacilityCount += node.facilityCount;

      // Preserve isTarget flag: if ANY occurrence is a target, mark it as target
      if (node.isTarget && !existing.node.isTarget) {
        existing.node = {
          ...existing.node,
          isTarget: true,
        };
      }
    } else {
      // First encounter: create new entry
      nodeMap.set(key, {
        node,
        totalRate: node.targetRate,
        totalFacilityCount: node.facilityCount,
      });
    }

    // Recursively process dependencies
    node.dependencies.forEach(collect);
  };

  rootNodes.forEach(collect);
  return nodeMap;
}

/**
 * Generates a stable and readable node ID from a given key.
 * A prefix is added to avoid collisions with other ID formats.
 *
 * @param key The unique key generated for a ProductionNode
 * @returns A formatted node ID
 */
export const makeNodeIdFromKey = (key: string) => `node-${key}`;

/**
 * Identifies target nodes that serve as upstream dependencies for other targets.
 * These targets need both a production node (marked as target) and a separate target sink.
 *
 * @param rootNodes Root nodes of the dependency tree
 * @returns Set of node keys for targets that are upstream of other targets
 */
export function findTargetsWithDownstream(
  rootNodes: ProductionNode[],
): Set<string> {
  const allTargets = new Set<string>();
  const downstreamTargets = new Set<string>();

  // Step 1: Collect all target node keys
  const collectTargets = (node: ProductionNode, visited: Set<string>) => {
    const key = createFlowNodeKey(node);
    if (visited.has(key)) return;
    visited.add(key);
    if (node.isTarget) allTargets.add(key);
    node.dependencies.forEach((dep) => collectTargets(dep, visited));
  };
  rootNodes.forEach((root) => collectTargets(root, new Set()));

  // Step 2: For each target, mark any target in its dependency tree as upstream
  const markUpstreamTargets = (
    originKey: string,
    node: ProductionNode,
    visited: Set<string>,
  ) => {
    const key = createFlowNodeKey(node);
    if (visited.has(key)) return;
    visited.add(key);

    if (key !== originKey && allTargets.has(key)) {
      downstreamTargets.add(key);
    }
    node.dependencies.forEach((dep) =>
      markUpstreamTargets(originKey, dep, visited),
    );
  };

  rootNodes.forEach((root) => {
    const key = createFlowNodeKey(root);
    if (root.isTarget) {
      root.dependencies.forEach((dep) =>
        markUpstreamTargets(key, dep, new Set()),
      );
    }
  });

  return downstreamTargets;
}

export function shouldSkipNode(
  node: ProductionNode,
  nodeKey: string,
  targetsWithDownstream: Set<string>,
): boolean {
  return node.isTarget && !targetsWithDownstream.has(nodeKey);
}

/**
 * Creates a standardized edge for React Flow.
 * Edge type and styling will be determined automatically by applyEdgeStyling based on geometry.
 *
 * @param id Unique edge identifier
 * @param source Source node ID
 * @param target Target node ID
 * @param flowRate Flow rate in items per minute
 */
export function createEdge(
  id: string,
  source: string,
  target: string,
  flowRate: number,
): Edge {
  return {
    id,
    source,
    target,
    type: "default", // Temporary type, will be set by applyEdgeStyling based on direction
    label: `${flowRate.toFixed(2)} /min`,
    data: {
      flowRate,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#64748b",
    },
  };
}

/**
 * Applies dynamic styling to edges and automatically selects edge type based on geometry.
 * Should be called AFTER layout is applied, when nodes have actual positions.
 *
 * - Forward edges (source left of target in LR layout): use smoothstep for clean routing
 * - Backward edges (target left of source): use custom backward edge to avoid node overlap
 * - All edges get width proportional to flow rate
 *
 * @param edges Array of edges to style
 * @param nodes Array of nodes with layouted positions
 * @returns The same edges array with style and type properties applied
 */
export function applyEdgeStyling(
  edges: Edge[],
  nodes: Array<{ id: string; position: { x: number; y: number } }>,
): Edge[] {
  if (edges.length === 0) return edges;

  // Build node position map for quick lookup
  const nodePositions = new Map(nodes.map((n) => [n.id, n.position.x]));

  // Find max flow rate for normalization
  const flowRates: number[] = [];
  edges.forEach((e) => {
    const data = e.data as { flowRate?: number } | undefined;
    if (data?.flowRate !== undefined) {
      flowRates.push(data.flowRate);
    }
  });
  const maxFlowRate = Math.max(...flowRates, 1);

  return edges.map((edge) => {
    const data = edge.data as { flowRate?: number } | undefined;

    // Return unchanged if no valid data
    if (!data || typeof data.flowRate !== "number") {
      return edge;
    }

    const flowRate = data.flowRate;

    // Calculate stroke width based on flow rate (1-4 range)
    const normalizedRate = flowRate / maxFlowRate;
    const strokeWidth = 1 + normalizedRate * 3;

    // Determine edge type based on direction (for LR layout)
    const sourceX = nodePositions.get(edge.source);
    const targetX = nodePositions.get(edge.target);

    // Only check direction if both positions are available and non-zero
    const isBackwardEdge =
      sourceX !== undefined &&
      targetX !== undefined &&
      sourceX !== 0 &&
      targetX !== 0 &&
      targetX < sourceX - 10; // Add threshold to avoid false positives

    const edgeType = isBackwardEdge ? "backwardEdge" : "simplebezier";

    // Unified gray styling for all edges
    return {
      ...edge,
      type: edgeType,
      style: {
        strokeWidth,
        stroke: "#64748b",
        strokeLinecap: "round" as const,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#64748b",
      },
      // Add label background for better readability
      labelBgPadding: [8, 4] as [number, number],
      labelBgBorderRadius: 4,
      labelBgStyle: {
        fill: "#ffffff",
        fillOpacity: 0.9,
      },
      labelStyle: {
        fontSize: 12,
      },
    };
  });
}
