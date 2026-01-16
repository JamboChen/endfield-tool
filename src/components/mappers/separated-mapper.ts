import { Position } from "@xyflow/react";
import type { Edge } from "@xyflow/react";
import type {
  Item,
  Facility,
  ItemId,
  FlowProductionNode,
  FlowTargetNode,
  ProductionNode,
} from "@/types";
import { CapacityPoolManager } from "../flow/capacity-pool";
import {
  createFlowNodeKey,
  aggregateProductionNodes,
  type AggregatedProductionNodeData,
  findTargetsWithDownstream,
  shouldSkipNode,
  createEdge,
} from "../flow/flow-utils";
import { createFlowNodeId, createTargetSinkId } from "@/lib/node-keys";
import { calculateDemandRate, topologicalSort } from "@/lib/utils";

/**
 * Performs topological sort on production nodes to determine processing order.
 *
 * Returns nodes in dependency order (producers before consumers), ensuring that
 * when we allocate capacity, all upstream producers are already initialized.
 *
 * @param nodeMap Map of aggregated production data
 * @returns Array of node keys in topological order (leaves to roots)
 */
function topologicalSortNodes(
  nodeMap: Map<string, AggregatedProductionNodeData>,
): string[] {
  return topologicalSort(nodeMap, (data) => {
    const deps = new Set<string>();
    data.node.dependencies.forEach((dep) => {
      const depKey = createFlowNodeKey(dep);
      if (nodeMap.has(depKey)) {
        deps.add(depKey);
      }
    });
    return deps;
  });
}

/**
 * Collects all produced (non-raw) item IDs from the node map.
 * Used to identify circular dependencies (raw materials that are actually produced).
 */
function collectProducedItems(
  nodeMap: Map<string, AggregatedProductionNodeData>,
): Set<ItemId> {
  const produced = new Set<ItemId>();
  nodeMap.forEach((data) => {
    if (!data.node.isRawMaterial && data.node.recipe) {
      produced.add(data.node.item.id);
    }
  });
  return produced;
}

/**
 * Checks if a node is a circular dependency:
 * - It's marked as a raw material
 * - But it's actually produced somewhere in the production chain
 *
 * These nodes should be skipped in favor of their production versions.
 */
function isCircularDependency(
  node: ProductionNode,
  producedItemIds: Set<ItemId>,
): boolean {
  if (node.isCyclePlaceholder) {
    return true;
  }

  // Raw material that's actually produced (circular dependency)
  if (node.isRawMaterial && producedItemIds.has(node.item.id)) {
    return true;
  }

  return false;
}

/**
 * Maps a UnifiedProductionPlan to React Flow nodes and edges in separated mode.
 *
 * In separated mode, each physical facility is represented as an individual node.
 * This provides a detailed view suitable for planning physical layouts and
 * understanding resource distribution.
 *
 * The algorithm:
 * 1. Collects and deduplicates production nodes
 * 2. Creates capacity pools for each unique production step
 * 3. Generates individual facility nodes
 * 4. Allocates capacity and creates edges using demand-driven allocation
 * 5. Creates target sink nodes for user-defined goals
 *
 * @param rootNodes The root ProductionNodes of the dependency tree
 * @param items All available items in the game
 * @param facilities All available facilities in the game
 * @param originalTargets Original user-defined production targets (optional)
 * @returns An object containing the generated React Flow nodes and edges
 */
export function mapPlanToFlowSeparated(
  rootNodes: ProductionNode[],
  items: Item[],
  facilities: Facility[],
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  const nodeMap = aggregateProductionNodes(rootNodes);
  const sortedKeys = topologicalSortNodes(nodeMap);
  const targetsWithDownstream = findTargetsWithDownstream(rootNodes);
  const producedItemIds = collectProducedItems(nodeMap);

  // Initialize capacity pools
  const poolManager = new CapacityPoolManager();
  sortedKeys.forEach((key) => {
    const aggregatedData = nodeMap.get(key)!;
    const node = aggregatedData.node;

    if (shouldSkipNode(node, key, targetsWithDownstream)) return;
    if (isCircularDependency(node, producedItemIds)) return;

    if (!node.isRawMaterial && !node.recipe) {
      console.warn(`Skipping invalid production node without recipe: ${key}`);
      return;
    }

    poolManager.createPool(
      {
        ...node,
        targetRate: aggregatedData.totalRate,
        facilityCount: aggregatedData.totalFacilityCount,
      },
      key,
    );
  });

  // Generate production nodes
  const flowNodes: FlowProductionNode[] = [];
  nodeMap.forEach((aggregatedData, key) => {
    const node = aggregatedData.node;

    if (shouldSkipNode(node, key, targetsWithDownstream)) return;
    if (isCircularDependency(node, producedItemIds)) return;

    if (!node.isRawMaterial && !node.recipe) {
      console.warn(`Skipping invalid production node without recipe: ${key}`);
      return;
    }
    const isDirectTarget = node.isTarget && targetsWithDownstream.has(key);
    const directTargetRate = isDirectTarget
      ? aggregatedData.totalRate
      : undefined;

    if (node.isRawMaterial) {
      flowNodes.push(
        createProductionFlowNode(
          createFlowNodeId(key),
          {
            ...node,
            targetRate: aggregatedData.totalRate,
            facilityCount: aggregatedData.totalFacilityCount,
          },
          items,
          facilities,
          undefined,
          undefined,
          undefined,
          isDirectTarget,
          directTargetRate,
        ),
      );
    } else {
      poolManager.getFacilityInstances(key).forEach((facility) => {
        flowNodes.push(
          createProductionFlowNode(
            facility.facilityId,
            {
              ...node,
              targetRate: facility.actualOutputRate,
              facilityCount: 1,
            },
            items,
            facilities,
            facility.facilityIndex,
            poolManager.getFacilityInstances(key).length,
            facility.actualOutputRate < facility.maxOutputRate * 0.999,
            isDirectTarget,
            directTargetRate,
          ),
        );
      });
    }
  });

  // Generate edges
  const edges: Edge[] = [];
  let edgeIdCounter = 0;

  [...sortedKeys].reverse().forEach((consumerKey) => {
    const consumerData = nodeMap.get(consumerKey)!;
    const consumerNode = consumerData.node;

    if (shouldSkipNode(consumerNode, consumerKey, targetsWithDownstream))
      return;
    if (isCircularDependency(consumerNode, producedItemIds)) return;

    if (!consumerNode.recipe) {
      console.warn(`Skipping node without recipe: ${consumerKey}`);
      return;
    }

    poolManager
      .getFacilityInstances(consumerKey)
      .forEach((consumerFacility) => {
        consumerNode.dependencies.forEach((dependency) => {
          const recipe = consumerNode.recipe!;
          const demandRate = calculateDemandRate(
            recipe,
            dependency.item.id,
            consumerNode.item.id,
            consumerFacility.actualOutputRate,
          );

          if (demandRate === null) return;

          // Check if this is a circular dependency
          if (isCircularDependency(dependency, producedItemIds)) {
            const productionKey = findProductionKeyForItem(
              dependency.item.id,
              nodeMap,
            );
            if (productionKey) {
              poolManager
                .allocate(productionKey, demandRate)
                .forEach((allocation) => {
                  edges.push(
                    createEdge(
                      `e${edgeIdCounter++}`,
                      allocation.sourceNodeId,
                      consumerFacility.facilityId,
                      allocation.allocatedAmount,
                    ),
                  );
                });
            }
          } else {
            const depKey = createFlowNodeKey(dependency);

            if (dependency.isRawMaterial) {
              const sourceNodeId = createFlowNodeId(depKey);
              edges.push(
                createEdge(
                  `e${edgeIdCounter++}`,
                  sourceNodeId,
                  consumerFacility.facilityId,
                  demandRate,
                ),
              );
            } else {
              poolManager.allocate(depKey, demandRate).forEach((allocation) => {
                edges.push(
                  createEdge(
                    `e${edgeIdCounter++}`,
                    allocation.sourceNodeId,
                    consumerFacility.facilityId,
                    allocation.allocatedAmount,
                  ),
                );
              });
            }
          }
        });
      });
  });

  // Create target sink nodes
  const targetSinkNodes: FlowTargetNode[] = [];
  const targetNodes = Array.from(nodeMap.entries()).filter(
    ([, data]) => data.node.isTarget && !data.node.isRawMaterial,
  );

  targetNodes.forEach(([productionKey, data]) => {
    const targetNodeId = createTargetSinkId(data.node.item.id);
    const hasDownstream = targetsWithDownstream.has(productionKey);

    targetSinkNodes.push({
      id: targetNodeId,
      type: "targetSink",
      data: {
        item: data.node.item,
        targetRate: data.totalRate,
        items,
        facilities,
        productionInfo: !hasDownstream
          ? {
              facility: data.node.facility,
              facilityCount: data.totalFacilityCount,
              recipe: data.node.recipe,
            }
          : undefined,
      },
      position: { x: 0, y: 0 },
      targetPosition: Position.Left,
    });

    if (hasDownstream) {
      poolManager
        .allocate(productionKey, data.totalRate)
        .forEach((allocation) => {
          edges.push(
            createEdge(
              `e${edgeIdCounter++}`,
              allocation.sourceNodeId,
              targetNodeId,
              allocation.allocatedAmount,
            ),
          );
        });
    } else {
      edges.push(
        ...createTargetDependencyEdges(
          data.node,
          targetNodeId,
          data.totalRate,
          poolManager,
          nodeMap,
          { count: edgeIdCounter },
          producedItemIds,
        ),
      );
      edgeIdCounter = edges.length;
    }
  });

  return {
    nodes: [...flowNodes, ...targetSinkNodes],
    edges: edges,
  };
}

/**
 * Helper: Creates target dependency edges with cycle awareness
 */
function createTargetDependencyEdges(
  targetNode: ProductionNode,
  targetNodeId: string,
  totalRate: number,
  poolManager: CapacityPoolManager,
  nodeMap: Map<string, AggregatedProductionNodeData>,
  edgeIdCounter: { count: number },
  producedItemIds: Set<ItemId>,
): Edge[] {
  const edges: Edge[] = [];
  const recipe = targetNode.recipe;
  if (!recipe) return edges;

  targetNode.dependencies.forEach((dep) => {
    const demandRate = calculateDemandRate(
      recipe,
      dep.item.id,
      targetNode.item.id,
      totalRate,
    );
    if (demandRate === null) return;

    // Check if this is a circular dependency
    if (isCircularDependency(dep, producedItemIds)) {
      const productionKey = findProductionKeyForItem(dep.item.id, nodeMap);
      if (productionKey) {
        poolManager
          .allocate(productionKey, demandRate)
          .forEach((allocation) => {
            edges.push(
              createEdge(
                `e${edgeIdCounter.count++}`,
                allocation.sourceNodeId,
                targetNodeId,
                allocation.allocatedAmount,
              ),
            );
          });
      }
    } else {
      const depKey = createFlowNodeKey(dep);

      if (dep.isRawMaterial) {
        edges.push(
          createEdge(
            `e${edgeIdCounter.count++}`,
            createFlowNodeId(depKey),
            targetNodeId,
            demandRate,
          ),
        );
      } else {
        poolManager.allocate(depKey, demandRate).forEach((allocation) => {
          edges.push(
            createEdge(
              `e${edgeIdCounter.count++}`,
              allocation.sourceNodeId,
              targetNodeId,
              allocation.allocatedAmount,
            ),
          );
        });
      }
    }
  });

  return edges;
}

/**
 * Helper: Finds production key for a given item ID
 */
function findProductionKeyForItem(
  itemId: ItemId,
  nodeMap: Map<string, AggregatedProductionNodeData>,
): string | null {
  for (const [key, data] of nodeMap.entries()) {
    if (
      !data.node.isRawMaterial &&
      data.node.item.id === itemId &&
      data.node.recipe
    ) {
      return key;
    }
  }
  return null;
}

/**
 * Helper: Creates production flow node
 */
function createProductionFlowNode(
  nodeId: string,
  node: ProductionNode,
  items: Item[],
  facilities: Facility[],
  facilityIndex?: number,
  totalFacilities?: number,
  isPartialLoad?: boolean,
  isDirectTarget?: boolean,
  directTargetRate?: number,
): FlowProductionNode {
  return {
    id: nodeId,
    type: "productionNode",
    data: {
      productionNode: node,
      items,
      facilities,
      facilityIndex,
      totalFacilities,
      isPartialLoad,
      isDirectTarget,
      directTargetRate,
    },
    position: { x: 0, y: 0 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  };
}
