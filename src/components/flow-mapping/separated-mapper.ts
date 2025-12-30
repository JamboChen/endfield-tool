import { Position, MarkerType } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import type { Item, Facility, Recipe } from "@/types";
import type { DetectedCycle, ProductionNode } from "@/lib/calculator";
import type {
  FlowProductionNode,
  FlowNodeDataSeparated,
  FlowNodeDataSeparatedWithTarget,
  FlowTargetNode,
} from "./types";
import { CapacityPoolManager } from "./capacity-pool";
import { applyEdgeStyling } from "./edge-styling";
import {
  createFlowNodeKey,
  aggregateProductionNodes,
  makeNodeIdFromKey,
  type AggregatedProductionNodeData,
  findTargetsWithDownstream,
  shouldSkipNode,
  createCycleInfo,
  isCircularBreakpoint,
  findProductionKeyForItem,
} from "./flow-utils";

/**
 * Performs topological sort on production nodes to determine processing order.
 *
 * Returns nodes in dependency order (producers before consumers), ensuring that
 * when we allocate capacity, all upstream producers are already initialized.
 *
 * @param nodeMap Map of aggregated production data
 * @returns Array of node keys in topological order (leaves to roots)
 */
function topologicalSort(
  nodeMap: Map<string, AggregatedProductionNodeData>,
): string[] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, Set<string>>();

  // Initialize structures
  nodeMap.forEach((_, key) => {
    inDegree.set(key, 0);
    adjList.set(key, new Set());
  });

  // Build adjacency list and calculate in-degrees
  nodeMap.forEach((data, key) => {
    data.node.dependencies.forEach((dep) => {
      const depKey = createFlowNodeKey(dep);
      if (nodeMap.has(depKey)) {
        adjList.get(depKey)!.add(key);
        inDegree.set(key, (inDegree.get(key) || 0) + 1);
      }
    });
  });

  // Start with nodes that have no dependencies (in-degree 0)
  const queue: string[] = [];
  inDegree.forEach((degree, key) => {
    if (degree === 0) {
      queue.push(key);
    }
  });

  // Process queue to build topological order
  const sorted: string[] = [];
  while (queue.length > 0) {
    const key = queue.shift()!;
    sorted.push(key);

    // Reduce in-degree for dependent nodes
    adjList.get(key)!.forEach((dependentKey) => {
      const newDegree = inDegree.get(dependentKey)! - 1;
      inDegree.set(dependentKey, newDegree);
      if (newDegree === 0) {
        queue.push(dependentKey);
      }
    });
  }

  return sorted;
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
  detectedCycles: DetectedCycle[] = [],
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  // Step 1: Collect unique nodes and determine processing order
  const nodeMap = aggregateProductionNodes(rootNodes);
  const sortedKeys = topologicalSort(nodeMap);

  // Identify which targets are upstream of other targets
  const targetsWithDownstream = findTargetsWithDownstream(rootNodes);

  // Create item map for cycle display name generation
  const itemMap = new Map(items.map((item) => [item.id, item]));

  // Step 2: Initialize capacity pool manager (skip circular breakpoints)
  const poolManager = new CapacityPoolManager();

  sortedKeys.forEach((key) => {
    const aggregatedData = nodeMap.get(key)!;
    const node = aggregatedData.node;

    if (shouldSkipNode(node, key, targetsWithDownstream)) {
      return;
    }

    // Skip circular breakpoint nodes - they don't need pools
    if (isCircularBreakpoint(node, detectedCycles)) {
      return;
    }

    const aggregatedNode: ProductionNode = {
      ...node,
      targetRate: aggregatedData.totalRate,
      facilityCount: aggregatedData.totalFacilityCount,
    };

    poolManager.createPool(aggregatedNode, key);
  });

  // Step 3: Generate Flow nodes (skip terminal targets and circular breakpoints)
  const flowNodes: Node<
    FlowNodeDataSeparated | FlowNodeDataSeparatedWithTarget
  >[] = [];
  const targetSinkNodes: FlowTargetNode[] = [];

  nodeMap.forEach((aggregatedData, key) => {
    const node = aggregatedData.node;

    if (shouldSkipNode(node, key, targetsWithDownstream)) {
      return;
    }

    // Skip circular breakpoint nodes
    if (isCircularBreakpoint(node, detectedCycles)) {
      return;
    }

    // Check if this node is a target with downstream
    const isDirectTarget = node.isTarget && targetsWithDownstream.has(key);
    const directTargetRate = isDirectTarget
      ? aggregatedData.totalRate
      : undefined;

    if (node.isRawMaterial) {
      // Regular raw material node (not a circular breakpoint)
      const aggregatedNode: ProductionNode = {
        ...node,
        targetRate: aggregatedData.totalRate,
        facilityCount: aggregatedData.totalFacilityCount,
      };

      const cycleInfo = createCycleInfo(node, detectedCycles, itemMap);

      flowNodes.push({
        id: makeNodeIdFromKey(key),
        type: "productionNode",
        data: {
          productionNode: aggregatedNode,
          isCircular: false,
          items,
          facilities,
          isDirectTarget,
          directTargetRate,
          cycleInfo,
        },
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    } else {
      // Production node - create individual facility instances
      const facilityInstances = poolManager.getFacilityInstances(key);
      const totalFacilities = facilityInstances.length;

      facilityInstances.forEach((facility) => {
        const isPartialLoad =
          facility.actualOutputRate < facility.maxOutputRate * 0.999;

        const facilitySpecificNode: ProductionNode = {
          ...node,
          targetRate: facility.actualOutputRate,
          facilityCount: 1,
        };

        const cycleInfo = createCycleInfo(node, detectedCycles, itemMap);

        flowNodes.push({
          id: facility.facilityId,
          type: "productionNode",
          data: {
            productionNode: facilitySpecificNode,
            isCircular: false,
            items,
            facilities,
            facilityIndex: facility.facilityIndex,
            totalFacilities,
            isPartialLoad,
            isDirectTarget,
            directTargetRate,
            cycleInfo,
          },
          position: { x: 0, y: 0 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        });
      });
    }
  });

  // Step 4: Generate edges (redirect circular dependencies)
  const edges: Edge[] = [];
  let edgeIdCounter = 0;

  const reverseOrder = [...sortedKeys].reverse();

  reverseOrder.forEach((consumerKey) => {
    const consumerData = nodeMap.get(consumerKey)!;
    const consumerNode = consumerData.node;

    if (shouldSkipNode(consumerNode, consumerKey, targetsWithDownstream)) {
      return;
    }

    // Skip if this is a circular breakpoint (no pool was created)
    if (isCircularBreakpoint(consumerNode, detectedCycles)) {
      return;
    }

    const consumerFacilities = poolManager.getFacilityInstances(consumerKey);

    consumerFacilities.forEach((consumerFacility) => {
      const consumerId = consumerFacility.facilityId;
      const consumerOutputRate = consumerFacility.actualOutputRate;

      consumerNode.dependencies.forEach((dependency) => {
        const depKey = createFlowNodeKey(dependency);

        const recipe = consumerNode.recipe!;
        const demandRate = calculateDemandRate(
          recipe,
          dependency.item.id,
          consumerNode.item.id,
          consumerOutputRate,
        );

        if (demandRate === null) {
          console.warn(`Recipe mismatch for ${consumerNode.item.id}`);
          return;
        }

        // Check if dependency is a circular breakpoint
        const isBreakpoint = isCircularBreakpoint(dependency, detectedCycles);

        if (isBreakpoint) {
          // Redirect to the production node pool
          const productionKey = findProductionKeyForItem(
            dependency.item.id,
            nodeMap,
          );

          if (productionKey) {
            const allocations = poolManager.allocate(productionKey, demandRate);

            allocations.forEach((allocation) => {
              edges.push({
                id: `e${edgeIdCounter++}`,
                source: allocation.sourceNodeId,
                target: consumerId,
                type: "default",
                label: `${allocation.allocatedAmount.toFixed(2)} /min`,
                data: {
                  flowRate: allocation.allocatedAmount,
                  isPartOfCycle: true,
                },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                },
              });
            });
          } else {
            console.warn(
              `Production key not found for circular breakpoint: ${dependency.item.id}`,
            );
          }
        } else if (dependency.isRawMaterial) {
          // Regular raw material
          const rawMaterialNodeId = makeNodeIdFromKey(depKey);
          edges.push({
            id: `e${edgeIdCounter++}`,
            source: rawMaterialNodeId,
            target: consumerId,
            type: "default",
            label: `${demandRate.toFixed(2)} /min`,
            data: { flowRate: demandRate },
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
          });
        } else {
          // Regular production dependency
          const allocations = poolManager.allocate(depKey, demandRate);

          allocations.forEach((allocation) => {
            edges.push({
              id: `e${edgeIdCounter++}`,
              source: allocation.sourceNodeId,
              target: consumerId,
              type: "default",
              label: `${allocation.allocatedAmount.toFixed(2)} /min`,
              data: { flowRate: allocation.allocatedAmount },
              markerEnd: {
                type: MarkerType.ArrowClosed,
              },
            });
          });
        }
      });
    });
  });

  // Step 5: Create target sink nodes
  const targetNodes = Array.from(nodeMap.entries()).filter(
    ([, data]) => data.node.isTarget && !data.node.isRawMaterial,
  );

  targetNodes.forEach(([productionKey, data]) => {
    const targetNodeId = `target-sink-${data.node.item.id}`;
    const hasDownstream = targetsWithDownstream.has(productionKey);

    const productionInfo = !hasDownstream
      ? {
          facility: data.node.facility,
          facilityCount: data.totalFacilityCount,
          recipe: data.node.recipe,
        }
      : undefined;

    targetSinkNodes.push({
      id: targetNodeId,
      type: "targetSink",
      data: {
        item: data.node.item,
        targetRate: data.totalRate,
        items,
        facilities,
        productionInfo,
      },
      position: { x: 0, y: 0 },
      targetPosition: Position.Left,
    });

    if (hasDownstream) {
      const allocations = poolManager.allocate(productionKey, data.totalRate);

      allocations.forEach((allocation) => {
        edges.push({
          id: `e${edgeIdCounter++}`,
          source: allocation.sourceNodeId,
          target: targetNodeId,
          type: "default",
          label: `${allocation.allocatedAmount.toFixed(2)} /min`,
          data: { flowRate: allocation.allocatedAmount },
          animated: true,
          style: { stroke: "#10b981", strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#10b981",
          },
        });
      });
    } else {
      const targetNode = data.node;

      targetNode.dependencies.forEach((dep) => {
        const depKey = createFlowNodeKey(dep);

        const recipe = targetNode.recipe;
        if (!recipe) return;

        const demandRate = calculateDemandRate(
          recipe,
          dep.item.id,
          targetNode.item.id,
          data.totalRate,
        );

        if (demandRate === null) return;

        // Check if dependency is a circular breakpoint
        const isBreakpoint = isCircularBreakpoint(dep, detectedCycles);

        if (isBreakpoint) {
          const productionKey = findProductionKeyForItem(dep.item.id, nodeMap);

          if (productionKey) {
            const allocations = poolManager.allocate(productionKey, demandRate);

            allocations.forEach((allocation) => {
              edges.push({
                id: `e${edgeIdCounter++}`,
                source: allocation.sourceNodeId,
                target: targetNodeId,
                type: "default",
                label: `${allocation.allocatedAmount.toFixed(2)} /min`,
                data: {
                  flowRate: allocation.allocatedAmount,
                  isPartOfCycle: true,
                },
                animated: true,
                style: { stroke: "#10b981", strokeWidth: 2 },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: "#10b981",
                },
              });
            });
          }
        } else if (dep.isRawMaterial) {
          const rawMaterialNodeId = makeNodeIdFromKey(depKey);
          edges.push({
            id: `e${edgeIdCounter++}`,
            source: rawMaterialNodeId,
            target: targetNodeId,
            type: "default",
            label: `${demandRate.toFixed(2)} /min`,
            data: { flowRate: demandRate },
            animated: true,
            style: { stroke: "#10b981", strokeWidth: 2 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "#10b981",
            },
          });
        } else {
          const allocations = poolManager.allocate(depKey, demandRate);

          allocations.forEach((allocation) => {
            edges.push({
              id: `e${edgeIdCounter++}`,
              source: allocation.sourceNodeId,
              target: targetNodeId,
              type: "default",
              label: `${allocation.allocatedAmount.toFixed(2)} /min`,
              data: { flowRate: allocation.allocatedAmount },
              animated: true,
              style: { stroke: "#10b981", strokeWidth: 2 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "#10b981",
              },
            });
          });
        }
      });
    }
  });

  // Step 6: Add cycle closure edges to visualize loops
  detectedCycles.forEach((cycle) => {
    const breakPointItemId = cycle.breakPointItemId;
    const cycleLength = cycle.involvedItemIds.length;
    if (cycleLength < 2) return;

    // The breakpoint is where the cycle is broken
    // We need to find which node in the cycle CONSUMES the breakpoint item
    const breakPointIndex = cycle.involvedItemIds.indexOf(breakPointItemId);

    // Find the consumer: the item that comes AFTER the breakpoint in the cycle
    const consumerIndex = (breakPointIndex + 1) % cycleLength;
    const consumerItemId = cycle.involvedItemIds[consumerIndex];

    // Find the corresponding production nodes
    const breakPointProductionKey = findProductionKeyForItem(
      breakPointItemId,
      nodeMap,
    );
    const consumerProductionKey = findProductionKeyForItem(
      consumerItemId,
      nodeMap,
    );

    if (!breakPointProductionKey || !consumerProductionKey) {
      console.warn(
        `Cannot create cycle closure edge: missing production keys for ${breakPointItemId} or ${consumerItemId}`,
      );
      return;
    }

    // Get facility instances
    const breakPointFacilities = poolManager.getFacilityInstances(
      breakPointProductionKey,
    );
    const consumerFacilities = poolManager.getFacilityInstances(
      consumerProductionKey,
    );

    if (breakPointFacilities.length === 0 || consumerFacilities.length === 0) {
      console.warn(
        `Cannot create cycle closure edge: no facilities found for ${breakPointItemId} or ${consumerItemId}`,
      );
      return;
    }

    // Find the recipe of the consumer to calculate flow rate
    const consumerNode = nodeMap.get(consumerProductionKey)?.node;
    if (!consumerNode?.recipe) {
      console.warn(`Consumer node has no recipe: ${consumerItemId}`);
      return;
    }

    // Calculate total flow rate for the cycle closure
    // This is the total amount of breakpoint item consumed by all consumer facilities
    const breakPointInput = consumerNode.recipe.inputs.find(
      (input) => input.itemId === breakPointItemId,
    );

    if (!breakPointInput) {
      console.warn(
        `Recipe for ${consumerItemId} does not consume ${breakPointItemId}`,
      );
      return;
    }

    // Calculate total consumption rate across all consumer facilities
    const consumerOutput = consumerNode.recipe.outputs.find(
      (output) => output.itemId === consumerItemId,
    );

    if (!consumerOutput) {
      console.warn(`Recipe output mismatch for ${consumerItemId}`);
      return;
    }

    const totalConsumerRate = consumerFacilities.reduce(
      (sum, f) => sum + f.actualOutputRate,
      0,
    );
    const inputOutputRatio = breakPointInput.amount / consumerOutput.amount;
    const totalFlowRate = inputOutputRatio * totalConsumerRate;

    // Strategy: Connect from breakpoint facilities to consumer facilities
    // Distribute connections to balance the visual layout
    let remainingFlow = totalFlowRate;
    let consumerIdx = 0;

    breakPointFacilities.forEach((breakPointFacility, idx) => {
      if (remainingFlow <= 0.001) return;

      // Calculate how much this breakpoint facility should provide
      const facilityCapacity = breakPointFacility.actualOutputRate;
      const flowFromThisFacility = Math.min(facilityCapacity, remainingFlow);

      // Determine target consumer facility (round-robin distribution)
      const targetConsumer =
        consumerFacilities[consumerIdx % consumerFacilities.length];

      edges.push({
        id: `cycle-closure-${cycle.cycleId}-${idx}`,
        source: breakPointFacility.facilityId,
        target: targetConsumer.facilityId,
        type: "default",
        animated: true,
        style: {
          stroke: "#a855f7", // purple-500
          strokeWidth: 2.5,
          strokeDasharray: "5,5",
        },
        label: `🔄 ${flowFromThisFacility.toFixed(2)} /min`,
        labelStyle: {
          fill: "#a855f7",
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: "#faf5ff",
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#a855f7",
        },
        data: { flowRate: flowFromThisFacility, isCycleClosure: true },
      });

      remainingFlow -= flowFromThisFacility;
      consumerIdx++;
    });

    // Verify all flow is accounted for
    if (remainingFlow > 0.001) {
      console.warn(
        `Cycle closure incomplete: ${remainingFlow.toFixed(2)} /min remaining for cycle ${cycle.cycleId}`,
      );
    }
  });
  const styledEdges = applyEdgeStyling(edges);

  return {
    nodes: [...flowNodes, ...targetSinkNodes] as (
      | FlowProductionNode
      | FlowTargetNode
    )[],
    edges: styledEdges,
  };
}

function calculateDemandRate(
  recipe: Recipe,
  inputItemId: string,
  outputItemId: string,
  outputRate: number,
): number | null {
  const input = recipe.inputs.find((i) => i.itemId === inputItemId);
  const output = recipe.outputs.find((o) => o.itemId === outputItemId);

  if (!input || !output) {
    return null;
  }

  return (input.amount / output.amount) * outputRate;
}
