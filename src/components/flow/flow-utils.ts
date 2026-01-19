import type { EdgeDirection, ItemId, ProductionNode } from "@/types";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { createNodeKey } from "@/lib/node-keys";

export const createFlowNodeKey = createNodeKey;

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

/**
 * Creates a standardized edge for React Flow with optional pre-computed direction.
 *
 * @param id Unique edge identifier
 * @param source Source node ID
 * @param target Target node ID
 * @param flowRate Flow rate in items per minute
 * @param direction Optional pre-computed direction (from markEdgeDirections)
 */
export function createEdge(
  id: string,
  source: string,
  target: string,
  flowRate: number,
  direction?: EdgeDirection,
): Edge {
  return {
    id,
    source,
    target,
    type: direction === "backward" ? "backwardEdge" : "simplebezier",
    label: `${flowRate.toFixed(2)} /min`,
    data: {
      flowRate,
      direction,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#64748b",
    },
  };
}

/**
 * Applies dynamic styling to edges based on flow rate and detects backward edges
 * based on actual node positions (when source X > target X).
 *
 * @param edges Array of edges to style
 * @param nodes Array of nodes with positions (after layout)
 * @returns The styled edges array with backward edges using backwardEdge type
 */
export function applyEdgeStyling(edges: Edge[], nodes: Node[]): Edge[] {
  if (edges.length === 0) return edges;

  // Build a position lookup map for O(1) access
  const nodePositions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node) => {
    if (node.position) {
      nodePositions.set(node.id, node.position);
    }
  });

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

    if (!data || typeof data.flowRate !== "number") {
      return edge;
    }

    const flowRate = data.flowRate;
    const normalizedRate = flowRate / maxFlowRate;

    // Calculate stroke width based on flow rate (1-4 range)
    const strokeWidth = 1 + normalizedRate * 3;

    // Calculate color based on normalized flow rate
    const strokeColor = getFlowRateColor(normalizedRate);

    // Calculate animation speed based on flow rate
    // Higher rate = faster animation (shorter duration)
    const minDuration = 1.5;
    const maxDuration = 10;
    const animationDuration =
      maxDuration * Math.pow(1 - normalizedRate, 1.5) +
      minDuration * Math.pow(normalizedRate, 0.5);

    // Detect backward edge based on actual node positions
    // If source X > target X, it's a backward edge (goes right to left)
    const sourcePos = nodePositions.get(edge.source);
    const targetPos = nodePositions.get(edge.target);
    const isBackward = sourcePos && targetPos && sourcePos.x > targetPos.x;

    return {
      ...edge,
      type: isBackward ? "backwardEdge" : "simplebezier",
      animated: true,
      style: {
        strokeWidth,
        stroke: strokeColor,
        strokeLinecap: "round" as const,
        animationDuration: `${animationDuration.toFixed(2)}s`,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 20,
        height: 20,
      },
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
