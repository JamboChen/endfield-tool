import type { ItemId } from "@/types";
import type { DetectedCycle, ProductionNode } from "@/lib/calculator";
import type { CycleInfo } from "./types";
import { getItemName } from "@/lib/i18n-helpers";
import { Position } from "@xyflow/react";

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
 * Finds the cycle that contains a given item, if any.
 *
 * @param itemId The item ID to search for
 * @param detectedCycles Array of all detected cycles
 * @returns The cycle containing this item, or undefined if not in any cycle
 */
function findCycleForItem(
  itemId: ItemId,
  detectedCycles: DetectedCycle[],
): DetectedCycle | undefined {
  return detectedCycles.find((cycle) => cycle.involvedItemIds.includes(itemId));
}

/**
 * Generates a human-readable display name for a cycle.
 *
 * @param cycle The detected cycle
 * @param itemMap Map of item IDs to Item objects for name lookup
 * @returns A display name like "Seed-Plant Cycle"
 */
function generateCycleDisplayName(
  cycle: DetectedCycle,
  itemMap: Map<ItemId, import("@/types").Item>,
): string {
  // Take first 2-3 items for the name to keep it concise
  const maxItems = 3;
  const displayItems = cycle.involvedItemIds
    .slice(0, maxItems)
    .map((itemId) => {
      const item = itemMap.get(itemId);
      return item ? getItemName(item) : itemId;
    });

  const itemNames = displayItems.join("-");
  const hasMore = cycle.involvedItemIds.length > maxItems;

  return hasMore ? `${itemNames}... Cycle` : `${itemNames} Cycle`;
}

/**
 * Creates cycle information for a production node.
 *
 * @param node The production node to check
 * @param detectedCycles Array of all detected cycles
 * @param itemMap Map for generating display names
 * @returns CycleInfo if the node is in a cycle, undefined otherwise
 */
export function createCycleInfo(
  node: ProductionNode,
  detectedCycles: DetectedCycle[],
  itemMap: Map<ItemId, import("@/types").Item>,
): CycleInfo | undefined {
  const cycle = findCycleForItem(node.item.id, detectedCycles);

  if (!cycle) {
    return undefined;
  }

  const isBreakPoint = cycle.breakPointItemId === node.item.id;
  const cycleDisplayName = generateCycleDisplayName(cycle, itemMap);

  return {
    isPartOfCycle: true,
    isBreakPoint,
    cycleId: cycle.cycleId,
    cycleDisplayName,
  };
}

/**
 * Determines if an edge is part of a production cycle.
 *
 * @param sourceItemId The item ID of the source node
 * @param targetNodeId The React Flow node ID of the target
 * @param nodeKeyToId Map from node keys to React Flow node IDs
 * @param detectedCycles All detected cycles
 * @returns True if this edge connects two nodes within the same cycle
 */
export function isEdgePartOfCycle(
  sourceItemId: ItemId,
  targetNodeId: string,
  nodeKeyToId: Map<string, string>,
  detectedCycles: DetectedCycle[],
): boolean {
  // Find which cycle (if any) contains the source item
  const sourceCycle = detectedCycles.find((cycle) =>
    cycle.involvedItemIds.includes(sourceItemId),
  );

  if (!sourceCycle) {
    return false;
  }

  // Extract item ID from target node ID by looking up in the map
  let targetItemId: ItemId | null = null;

  for (const [key, nodeId] of nodeKeyToId.entries()) {
    if (nodeId === targetNodeId) {
      // Extract item ID from the key (format: "itemId__recipeId__rawFlag")
      targetItemId = key.split("__")[0] as ItemId;
      break;
    }
  }

  if (!targetItemId) {
    return false;
  }

  // Check if both source and target are in the same cycle
  const isTargetInCycle = sourceCycle.involvedItemIds.includes(targetItemId);

  return isTargetInCycle;
}

/**
 * Determines the appropriate handle positions for an edge based on cycle status and node levels.
 *
 * @param sourceLevel The level of the source node
 * @param targetLevel The level of the target node
 * @param isPartOfCycle Whether this edge is part of a production cycle
 * @returns An object with sourcePosition and targetPosition
 */
export function determineHandlePositions(
  sourceLevel: number,
  targetLevel: number,
  isPartOfCycle: boolean,
): {
  sourcePosition: Position;
  targetPosition: Position;
  sourceHandle?: string;
  targetHandle?: string;
} {
  // For cycle edges between same or adjacent levels, use vertical connections
  const levelDiff = Math.abs(sourceLevel - targetLevel);

  if (isPartOfCycle && levelDiff <= 1) {
    // Use top/bottom handles for cycle edges
    return {
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      sourceHandle: "bottom",
      targetHandle: "top",
    };
  }

  // Default: horizontal connections for normal edges
  return {
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    sourceHandle: "right",
    targetHandle: "left",
  };
}

/**
 * Checks if a node is a circular breakpoint (a raw material node that's actually produced in a cycle).
 *
 * @param node The production node to check
 * @param detectedCycles All detected cycles
 * @returns True if this node is a breakpoint in any cycle
 */
export function isCircularBreakpoint(
  node: ProductionNode,
  detectedCycles: DetectedCycle[],
): boolean {
  if (!node.isRawMaterial) {
    return false;
  }

  return detectedCycles.some(
    (cycle) => cycle.breakPointItemId === node.item.id,
  );
}

/**
 * Finds the production node key for a given item ID within the aggregated nodes.
 * This is used to redirect circular breakpoint dependencies to their actual production nodes.
 *
 * @param itemId The item ID to search for
 * @param nodeMap Map of aggregated production nodes
 * @returns The production node key, or null if not found
 */
export function findProductionKeyForItem(
  itemId: ItemId,
  nodeMap: Map<string, AggregatedProductionNodeData>,
): string | null {
  for (const [key, data] of nodeMap.entries()) {
    const node = data.node;
    // Look for production nodes (not raw materials) that produce this item
    if (!node.isRawMaterial && node.item.id === itemId && node.recipe) {
      return key;
    }
  }
  return null;
}
