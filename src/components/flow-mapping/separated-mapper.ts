import { Position, MarkerType } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import type { Item, Facility } from "@/types";
import type { ProductionNode } from "@/lib/calculator";
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
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  // Step 1: Collect unique nodes with aggregated rates and determine processing order
  const nodeMap = aggregateProductionNodes(rootNodes);
  const sortedKeys = topologicalSort(nodeMap);

  // Step 2: Initialize capacity pool manager with aggregated production rates
  const poolManager = new CapacityPoolManager();

  sortedKeys.forEach((key) => {
    const aggregatedData = nodeMap.get(key)!;

    // Create a ProductionNode with aggregated totals for capacity calculation
    const aggregatedNode: ProductionNode = {
      ...aggregatedData.node,
      targetRate: aggregatedData.totalRate,
      facilityCount: aggregatedData.totalFacilityCount,
    };

    poolManager.createPool(aggregatedNode, key);
  });

  // Step 3: Generate Flow nodes from facility instances
  const flowNodes: Node<
    FlowNodeDataSeparated | FlowNodeDataSeparatedWithTarget
  >[] = [];
  const targetSinkNodes: FlowTargetNode[] = [];

  nodeMap.forEach((aggregatedData, key) => {
    const node = aggregatedData.node;

    // Check if this node is also a direct target
    const isDirectTarget = node.isTarget;
    const directTargetRate = isDirectTarget
      ? aggregatedData.totalRate
      : undefined;

    if (node.isRawMaterial) {
      // Raw materials are shown as single nodes (no facility splitting)
      // Use aggregated rate for display
      const isCircular = node.recipe !== null;
      const aggregatedNode: ProductionNode = {
        ...node,
        targetRate: aggregatedData.totalRate,
        facilityCount: aggregatedData.totalFacilityCount,
      };

      flowNodes.push({
        id: makeNodeIdFromKey(key),
        type: "productionNode",
        data: {
          productionNode: aggregatedNode,
          isCircular,
          items,
          facilities,
          isDirectTarget,
          directTargetRate,
        },
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    } else {
      // Production nodes are split into individual facilities
      const facilityInstances = poolManager.getFacilityInstances(key);
      const totalFacilities = facilityInstances.length;

      facilityInstances.forEach((facility) => {
        const isPartialLoad =
          facility.actualOutputRate < facility.maxOutputRate * 0.999; // Small epsilon for floating point comparison

        // Create a modified ProductionNode for this specific facility instance
        // with targetRate set to this facility's actual output rate
        const facilitySpecificNode: ProductionNode = {
          ...node,
          targetRate: facility.actualOutputRate,
          facilityCount: 1, // Each node represents exactly 1 facility
        };

        flowNodes.push({
          id: facility.facilityId,
          type: "productionNode",
          data: {
            productionNode: facilitySpecificNode,
            isCircular: false,
            items,
            facilities,
            // Separated mode specific fields
            facilityIndex: facility.facilityIndex,
            totalFacilities,
            isPartialLoad,
            isDirectTarget,
            directTargetRate,
          },
          position: { x: 0, y: 0 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        });
      });
    }
  });

  // Step 4: Generate edges by allocating capacity
  const edges: Edge[] = [];
  let edgeIdCounter = 0;

  // Process nodes in reverse topological order (consumers before producers)
  // This ensures we connect from producers to consumers
  const reverseOrder = [...sortedKeys].reverse();

  reverseOrder.forEach((consumerKey) => {
    const consumerData = nodeMap.get(consumerKey)!;
    const consumerNode = consumerData.node;

    // Skip raw materials (they don't consume anything)
    if (consumerNode.isRawMaterial) {
      return;
    }

    const consumerFacilities = poolManager.getFacilityInstances(consumerKey);

    // For each consumer facility, allocate inputs from producer facilities
    consumerFacilities.forEach((consumerFacility) => {
      const consumerId = consumerFacility.facilityId;
      const consumerOutputRate = consumerFacility.actualOutputRate;

      // Process each dependency (input material)
      consumerNode.dependencies.forEach((dependency) => {
        const depKey = createFlowNodeKey(dependency);

        // Calculate demand rate for this specific consumer facility
        const recipe = consumerNode.recipe!;
        const inputItem = recipe.inputs.find(
          (inp) => inp.itemId === dependency.item.id,
        );
        const outputItem = recipe.outputs.find(
          (out) => out.itemId === consumerNode.item.id,
        );

        if (!inputItem || !outputItem) {
          console.warn(
            `Recipe mismatch for ${consumerNode.item.id}: missing input or output`,
          );
          return;
        }

        // Calculate the input rate needed for this consumer's output rate
        const inputOutputRatio = inputItem.amount / outputItem.amount;
        const demandRate = inputOutputRatio * consumerOutputRate;

        // Allocate capacity from producer pool
        if (dependency.isRawMaterial) {
          // Connect directly to the raw material node
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
          // Allocate from capacity pool
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

  // Step 5: Create target sink nodes for each original target
  const targetNodes = Array.from(nodeMap.entries()).filter(
    ([, data]) => data.node.isTarget && !data.node.isRawMaterial,
  );

  targetNodes.forEach(([productionKey, data]) => {
    const targetNodeId = `target-sink-${data.node.item.id}`;
    const allocations = poolManager.allocate(productionKey, data.totalRate);

    targetSinkNodes.push({
      id: targetNodeId,
      type: "targetSink",
      data: {
        item: data.node.item,
        targetRate: data.totalRate,
        items,
      },
      position: { x: 0, y: 0 },
      targetPosition: Position.Left,
    });

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
  });
  // Apply dynamic styling to edges
  const styledEdges = applyEdgeStyling(edges);

  return {
    nodes: [...flowNodes, ...targetSinkNodes] as (
      | FlowProductionNode
      | FlowTargetNode
    )[],
    edges: styledEdges,
  };
}
