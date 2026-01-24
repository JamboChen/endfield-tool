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
  createEdge,
  createProductionFlowNode,
  createTargetSinkNode,
} from "../flow/flow-utils";
import { createFlowNodeId, createTargetSinkId } from "@/lib/node-keys";
import { calculateDemandRate } from "@/lib/utils";

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
 * Maps a UnifiedProductionPlan to React Flow nodes and edges in separated mode.
 *
 * In separated mode, each physical facility is represented as an individual node.
 * This provides a detailed view suitable for planning physical layouts and
 * understanding resource distribution.
 *
 * @param rootNodes The root ProductionNodes of the dependency tree
 * @param items All available items in the game
 * @param facilities All available facilities in the game
 * @returns An object containing the generated React Flow nodes and edges
 */
export function mapPlanToFlowSeparated(
  rootNodes: ProductionNode[],
  items: Item[],
  facilities: Facility[],
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  const aggregatedNodes = aggregateProductionNodes(rootNodes);
  const producedItemIds = collectProducedItems(aggregatedNodes);

  const poolManager = new CapacityPoolManager();
  const rawMaterialNodes = new Map<ItemId, string>();
  const flowNodes: FlowProductionNode[] = [];
  const targetSinkNodes: FlowTargetNode[] = [];
  const edges: Edge[] = [];
  const edgeIdCounter = { count: 0 };

  aggregatedNodes.forEach((data, key) => {
    if (!data.node.isRawMaterial) {
      poolManager.createPool(
        {
          ...data.node,
          facilityCount: data.totalFacilityCount,
          targetRate: data.totalRate,
        },
        key,
      );
    }
  });

  function ensureRawMaterialNode(
    itemId: ItemId,
    nodeKey: string,
    totalDemand: number,
    node: ProductionNode,
  ): string {
    let rawNodeId = rawMaterialNodes.get(itemId);

    if (!rawNodeId) {
      rawNodeId = createFlowNodeId(nodeKey);
      rawMaterialNodes.set(itemId, rawNodeId);

      flowNodes.push(
        createProductionFlowNode(
          rawNodeId,
          {
            ...node,
            targetRate: totalDemand,
            facilityCount: 0,
          },
          items,
          facilities,
          {
            isDirectTarget: false,
          },
        ),
      );
    }

    return rawNodeId;
  }

  function allocateUpstream(
    node: ProductionNode,
    demandRate: number,
    consumerFacilityId: string,
  ): void {
    if (isCircularDependency(node, producedItemIds)) {
      const productionKey = findProductionKeyForItem(
        node.item.id,
        aggregatedNodes,
      );

      if (!productionKey) {
        console.error(
          `Circular dependency: no production key found for ${node.item.id}`,
        );
        return;
      }

      const aggregatedData = aggregatedNodes.get(productionKey);
      if (!aggregatedData) {
        console.error(
          `Circular dependency: no aggregated data for ${productionKey}`,
        );
        return;
      }

      allocateFromPool(
        productionKey,
        aggregatedData.node,
        demandRate,
        consumerFacilityId,
        "backward",
      );
      return;
    }

    if (node.isRawMaterial) {
      const nodeKey = createFlowNodeKey(node);
      const aggregatedData = aggregatedNodes.get(nodeKey);
      const totalDemand = aggregatedData ? aggregatedData.totalRate : 0;

      const rawNodeId = ensureRawMaterialNode(
        node.item.id,
        nodeKey,
        totalDemand,
        node,
      );

      edges.push(
        createEdge(
          `e${edgeIdCounter.count++}`,
          rawNodeId,
          consumerFacilityId,
          demandRate,
        ),
      );
      return;
    }

    const nodeKey = createFlowNodeKey(node);
    allocateFromPool(nodeKey, node, demandRate, consumerFacilityId);
  }

  function allocateFromPool(
    nodeKey: string,
    node: ProductionNode,
    demandRate: number,
    consumerFacilityId: string,
    edgeDirection?: "backward",
  ): void {
    if (!poolManager.hasPool(nodeKey)) {
      console.warn(
        `Pool not found for ${nodeKey}, creating on-demand (this should not happen)`,
      );
      poolManager.createPool(node, nodeKey);
    }

    const allocations = poolManager.allocate(nodeKey, demandRate);

    allocations.forEach((allocation) => {
      edges.push(
        createEdge(
          `e${edgeIdCounter.count++}`,
          allocation.sourceNodeId,
          consumerFacilityId,
          allocation.allocatedAmount,
          edgeDirection,
        ),
      );

      if (!poolManager.isProcessed(allocation.sourceNodeId)) {
        poolManager.markProcessed(allocation.sourceNodeId);

        const facilityInstance = poolManager
          .getFacilityInstances(nodeKey)
          .find((f) => f.facilityId === allocation.sourceNodeId);

        if (facilityInstance) {
          const totalFacilities =
            poolManager.getFacilityInstances(nodeKey).length;
          const isPartialLoad =
            facilityInstance.actualOutputRate <
            facilityInstance.maxOutputRate * 0.999;

          // Create facility node
          flowNodes.push(
            createProductionFlowNode(
              allocation.sourceNodeId,
              {
                ...node,
                targetRate: facilityInstance.actualOutputRate,
                facilityCount: 1,
              },
              items,
              facilities,
              {
                facilityIndex: facilityInstance.facilityIndex,
                totalFacilities: totalFacilities,
                isPartialLoad: isPartialLoad,
                isDirectTarget: false,
              },
            ),
          );

          // Recursively process dependencies
          if (node.recipe) {
            node.dependencies.forEach((dep) => {
              const depDemandRate = calculateDemandRate(
                node.recipe!,
                dep.item.id,
                node.item.id,
                facilityInstance.actualOutputRate,
              );

              if (depDemandRate !== null) {
                allocateUpstream(dep, depDemandRate, allocation.sourceNodeId);
              }
            });
          }
        }
      }
    });
  }

  rootNodes.forEach((rootNode) => {
    const key = createFlowNodeKey(rootNode);

    const shouldSkip = rootNode.isTarget && !rootNode.isRawMaterial;
    if (shouldSkip) return;

    if (rootNode.isRawMaterial) {
      const nodeKey = createFlowNodeKey(rootNode);
      const aggregatedData = aggregatedNodes.get(nodeKey);
      const totalDemand = aggregatedData
        ? aggregatedData.totalRate
        : rootNode.targetRate;

      ensureRawMaterialNode(rootNode.item.id, nodeKey, totalDemand, rootNode);
    } else {
      const facilityInstances = poolManager.getFacilityInstances(key);

      facilityInstances.forEach((facilityInstance) => {
        if (poolManager.isProcessed(facilityInstance.facilityId)) return;

        poolManager.markProcessed(facilityInstance.facilityId);

        const isPartialLoad =
          facilityInstance.actualOutputRate <
          facilityInstance.maxOutputRate * 0.999;

        flowNodes.push(
          createProductionFlowNode(
            facilityInstance.facilityId,
            {
              ...rootNode,
              targetRate: facilityInstance.actualOutputRate,
              facilityCount: 1,
            },
            items,
            facilities,
            {
              facilityIndex: facilityInstance.facilityIndex,
              totalFacilities: facilityInstances.length,
              isPartialLoad: isPartialLoad,
              isDirectTarget: false,
            },
          ),
        );

        // Allocate upstream for this facility's dependencies
        if (rootNode.recipe) {
          rootNode.dependencies.forEach((dep) => {
            const depDemandRate = calculateDemandRate(
              rootNode.recipe!,
              dep.item.id,
              rootNode.item.id,
              facilityInstance.actualOutputRate,
            );

            if (depDemandRate !== null) {
              allocateUpstream(dep, depDemandRate, facilityInstance.facilityId);
            }
          });
        }
      });
    }
  });

  const allTargetsList = Array.from(aggregatedNodes.entries()).filter(
    ([, data]) => data.node.isTarget,
  );

  allTargetsList.forEach(([, data]) => {
    const targetSinkId = createTargetSinkId(data.node.item.id);

    const isRawMaterialTarget = data.node.isRawMaterial;

    const productionInfo = !isRawMaterialTarget
      ? {
          facility: data.node.facility,
          facilityCount: data.totalFacilityCount,
          recipe: data.node.recipe,
        }
      : undefined;

    targetSinkNodes.push(
      createTargetSinkNode(
        targetSinkId,
        data.node.item,
        data.totalRate,
        items,
        facilities,
        productionInfo,
      ),
    );

    if (!isRawMaterialTarget) {
      // Non-raw-material targets: connect dependencies directly to target sink
      if (data.node.recipe) {
        data.node.dependencies.forEach((dep) => {
          const depDemandRate = calculateDemandRate(
            data.node.recipe!,
            dep.item.id,
            data.node.item.id,
            data.totalRate,
          );

          if (depDemandRate !== null) {
            allocateUpstream(dep, depDemandRate, targetSinkId);
          }
        });
      }
    }
  });

  return {
    nodes: [...flowNodes, ...targetSinkNodes],
    edges: edges,
  };
}
