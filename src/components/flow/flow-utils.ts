import type { ItemId, ProductionNode } from "@/types";
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

  const producedItemIds = new Set<ItemId>();
  const collectProduced = (node: ProductionNode) => {
    if (node.isCyclePlaceholder) {
      node.dependencies.forEach(collectProduced);
      return;
    }
    if (!node.isRawMaterial && node.recipe) {
      producedItemIds.add(node.item.id);
    }
    node.dependencies.forEach(collectProduced);
  };
  rootNodes.forEach(collectProduced);

  const collect = (node: ProductionNode) => {
    // Skip cycle placeholders - they don't represent actual production
    if (node.isCyclePlaceholder) {
      // Still traverse their dependencies (though they should have none)
      node.dependencies.forEach(collect);
      return;
    }

    if (node.isRawMaterial && producedItemIds.has(node.item.id)) {
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
 * - All edges get color based on normalized flow rate (heat map: blue→green→red)
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

    // Calculate normalized rate (0-1)
    const normalizedRate = flowRate / maxFlowRate;

    // Calculate stroke width based on flow rate (1-4 range)
    const strokeWidth = 1 + normalizedRate * 3;

    // Calculate color based on normalized flow rate
    const strokeColor = getFlowRateColor(normalizedRate);

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

    // Apply heat map color styling
    return {
      ...edge,
      type: edgeType,
      style: {
        strokeWidth,
        stroke: strokeColor,
        strokeLinecap: "round" as const,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
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

/**
 * Interpolates between two RGB colors based on a factor (0-1).
 */
function interpolateColor(
  color1: string,
  color2: string,
  factor: number,
): string {
  const hex1 = color1.replace("#", "");
  const hex2 = color2.replace("#", "");

  const r1 = parseInt(hex1.substring(0, 2), 16);
  const g1 = parseInt(hex1.substring(2, 4), 16);
  const b1 = parseInt(hex1.substring(4, 6), 16);

  const r2 = parseInt(hex2.substring(0, 2), 16);
  const g2 = parseInt(hex2.substring(2, 4), 16);
  const b2 = parseInt(hex2.substring(4, 6), 16);

  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Maps a normalized flow rate (0-1) to a color on the heat map gradient.
 * 0.0 → Blue (cold, low flow)
 * 0.5 → Green (medium flow)
 * 1.0 → Red (hot, high flow)
 */
function getFlowRateColor(normalizedRate: number): string {
  const blue = "#3b82f6";
  const green = "#10b981";
  const red = "#ef4444";

  if (normalizedRate <= 0.5) {
    // Interpolate between blue and green
    return interpolateColor(blue, green, normalizedRate * 2);
  } else {
    // Interpolate between green and red
    return interpolateColor(green, red, (normalizedRate - 0.5) * 2);
  }
}
