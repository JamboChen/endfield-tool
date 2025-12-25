import { Position, MarkerType } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import type { Item, Facility } from "@/types";
import type { DetectedCycle, ProductionNode } from "@/lib/calculator";
import type {
  FlowNodeData,
  FlowProductionNode,
  FlowTargetNode,
  TargetSinkNodeData,
} from "./types";
import { applyEdgeStyling } from "./edge-styling";
import {
  createFlowNodeKey,
  aggregateProductionNodes,
  makeNodeIdFromKey,
  findTargetsWithDownstream,
  createCycleInfo,
} from "./flow-utils";

/**
 * Maps a UnifiedProductionPlan to React Flow nodes and edges in merged mode.
 *
 * In merged mode, identical production steps are combined into single nodes
 * showing aggregated facility counts and production rates. This provides
 * a high-level overview of the production requirements.
 *
 * The function traverses the dependency tree and creates:
 * - Nodes representing unique production steps
 * - Edges showing material flow between steps
 * - Styled edges based on flow rates
 *
 * @param rootNodes The root ProductionNodes of the dependency tree
 * @param items All available items in the game
 * @param facilities All available facilities in the game
 * @returns An object containing the generated React Flow nodes and edges
 */
export function mapPlanToFlowMerged(
  rootNodes: ProductionNode[],
  items: Item[],
  facilities: Facility[],
  detectedCycles: DetectedCycle[] = [],
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [];
  // Create item map for cycle display name generation
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const edges: Edge[] = [];
  const nodeKeyToId = new Map<string, string>();
  const targetSinkNodes: Node<TargetSinkNodeData>[] = [];

  const aggregatedNodes = aggregateProductionNodes(rootNodes);

  // Identify which targets are upstream of other targets
  const targetsWithDownstream = findTargetsWithDownstream(rootNodes);

  const getOrCreateNodeId = (node: ProductionNode): string => {
    const key = createFlowNodeKey(node);
    if (nodeKeyToId.has(key)) {
      return nodeKeyToId.get(key)!;
    }
    const nodeId = makeNodeIdFromKey(key);
    nodeKeyToId.set(key, nodeId);
    return nodeId;
  };

  /**
   * Recursively traverses the production dependency tree to create nodes and edges.
   *
   * Uses depth-first traversal to build the complete graph, ensuring all dependencies
   * are processed and connected properly.
   *
   * @param node The current ProductionNode being processed
   * @param parentId The ID of the parent node in the flow graph, or null if it's a root
   * @param edgeIdCounter An object to keep track of unique edge IDs
   * @returns The ID of the current node
   */
  const traverse = (
    node: ProductionNode,
    parentId: string | null = null,
    edgeIdCounter: { count: number },
  ): string => {
    const nodeId = getOrCreateNodeId(node);
    const key = createFlowNodeKey(node);

    // Skip creating production node if it's a target without downstream
    const isTargetWithoutDownstream =
      node.isTarget && !targetsWithDownstream.has(key);

    if (isTargetWithoutDownstream) {
      // Don't create a production node for pure targets
      // They will only exist as target sink nodes

      // Still need to process dependencies
      node.dependencies.forEach((dep) => {
        traverse(dep, null, edgeIdCounter);
      });

      return nodeId;
    }

    // Add node if it doesn't exist yet (using aggregated data)
    if (!nodes.find((n) => n.id === nodeId)) {
      const aggregatedData = aggregatedNodes.get(key)!;
      const isCircular = node.isRawMaterial && node.recipe !== null;

      // Check if this node is a target with downstream (needs marking)
      const isDirectTarget = node.isTarget && targetsWithDownstream.has(key);
      const directTargetRate = isDirectTarget
        ? aggregatedData.totalRate
        : undefined;

      // Create a ProductionNode with aggregated totals for display
      const aggregatedNode: ProductionNode = {
        ...aggregatedData.node,
        targetRate: aggregatedData.totalRate,
        facilityCount: aggregatedData.totalFacilityCount,
      };

      const cycleInfo = createCycleInfo(
        aggregatedData.node,
        detectedCycles,
        itemMap,
      );

      nodes.push({
        id: nodeId,
        type: "productionNode",
        data: {
          productionNode: aggregatedNode,
          isCircular,
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
    }

    // Create an edge from this node to its parent (if parent exists)
    if (parentId) {
      const flowRate = node.targetRate;

      // Avoid duplicate edges for shared dependencies
      const edgeExists = edges.some(
        (e) => e.source === nodeId && e.target === parentId,
      );

      if (!edgeExists) {
        const edgeId = `e${edgeIdCounter.count++}`;
        edges.push({
          id: edgeId,
          source: nodeId,
          target: parentId,
          type: "default",
          label: `${flowRate.toFixed(2)} /min`,
          data: { flowRate },
          markerEnd: {
            type: MarkerType.ArrowClosed,
          },
        });
      }
    }

    // Recursively traverse dependencies
    node.dependencies.forEach((dep) => {
      traverse(dep, nodeId, edgeIdCounter);
    });

    return nodeId;
  };

  // Build the graph starting from all root nodes
  const edgeIdCounter = { count: 0 };
  rootNodes.forEach((root) => traverse(root, null, edgeIdCounter));

  // Create target sink nodes for all targets
  const targetNodes = Array.from(aggregatedNodes.entries()).filter(
    ([, data]) => data.node.isTarget && !data.node.isRawMaterial,
  );

  targetNodes.forEach(([key, data]) => {
    const targetNodeId = `target-sink-${data.node.item.id}`;
    const hasDownstream = targetsWithDownstream.has(key);

    // Prepare production info for terminal targets (targets without downstream)
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
        productionInfo, // Pass production info for terminal targets
      },
      position: { x: 0, y: 0 },
      targetPosition: Position.Left,
    });

    if (hasDownstream) {
      // Target with downstream: connect from production node to target sink
      const productionNodeId = makeNodeIdFromKey(key);
      edges.push({
        id: `e${edgeIdCounter.count++}`,
        source: productionNodeId,
        target: targetNodeId,
        type: "default",
        label: `${data.totalRate.toFixed(2)} /min`,
        data: { flowRate: data.totalRate },
        animated: true,
        style: { stroke: "#10b981", strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#10b981",
        },
      });
    } else {
      // Target without downstream: connect directly from its dependencies
      const targetNode = data.node;
      targetNode.dependencies.forEach((dep) => {
        const depKey = createFlowNodeKey(dep);
        const depNodeId = makeNodeIdFromKey(depKey);

        const recipe = targetNode.recipe;
        if (!recipe) return;

        const inputItem = recipe.inputs.find(
          (inp) => inp.itemId === dep.item.id,
        );
        const outputItem = recipe.outputs.find(
          (out) => out.itemId === targetNode.item.id,
        );

        if (!inputItem || !outputItem) return;

        const inputOutputRatio = inputItem.amount / outputItem.amount;
        const flowRate = inputOutputRatio * data.totalRate;

        edges.push({
          id: `e${edgeIdCounter.count++}`,
          source: depNodeId,
          target: targetNodeId,
          type: "default",
          label: `${flowRate.toFixed(2)} /min`,
          data: { flowRate },
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

  // Add cycle closure edges to visualize loops
  detectedCycles.forEach((cycle) => {
    // The break point is where the cycle was interrupted
    const breakPointItemId = cycle.breakPointItemId;

    // Find the node that produces the break point item (the last node in the cycle)
    // This is the node that should connect back to the break point
    const cycleLength = cycle.involvedItemIds.length;
    if (cycleLength < 2) return; // Need at least 2 nodes for a cycle

    // Get the item that comes before the break point in the cycle
    const breakPointIndex = cycle.involvedItemIds.indexOf(breakPointItemId);
    const producerIndex = (breakPointIndex - 1 + cycleLength) % cycleLength;
    const producerItemId = cycle.involvedItemIds[producerIndex];

    // Find the corresponding cycle node to get the recipe
    const producerNode = cycle.cycleNodes.find(
      (node) => node.item.id === producerItemId,
    );

    if (!producerNode) return;

    // Create keys for both nodes
    const breakPointKey = createFlowNodeKey({
      item: { id: breakPointItemId } as Item,
      isRawMaterial: true,
      recipe: null,
    } as ProductionNode);

    const producerKey = createFlowNodeKey({
      item: { id: producerItemId } as Item,
      isRawMaterial: false,
      recipe: producerNode.recipe,
    } as ProductionNode);

    const breakPointNodeId = makeNodeIdFromKey(breakPointKey);
    const producerNodeId = makeNodeIdFromKey(producerKey);

    // Check if both nodes exist
    const breakPointExists = nodes.some((n) => n.id === breakPointNodeId);
    const producerExists = nodes.some((n) => n.id === producerNodeId);

    if (!breakPointExists || !producerExists) return;

    // Calculate flow rate for the cycle edge
    // This should be the rate at which the break point item is produced
    const breakPointNode = cycle.cycleNodes.find(
      (node) => node.item.id === breakPointItemId,
    );
    const flowRate = breakPointNode?.targetRate || 1;

    // Add the cycle closure edge
    edges.push({
      id: `cycle-closure-${cycle.cycleId}`,
      source: producerNodeId,
      target: breakPointNodeId,
      type: "default",
      animated: true,
      style: {
        stroke: "#a855f7", // purple-500
        strokeWidth: 2.5,
        strokeDasharray: "5,5",
      },
      label: `🔄 ${flowRate.toFixed(2)} /min`,
      labelStyle: {
        fill: "#a855f7",
        fontWeight: 600,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#a855f7",
      },
      data: { flowRate, isCycleClosure: true },
    });
    console.log("Cycle:", cycle.cycleId);
    console.log("Break point:", breakPointNodeId, "exists:", breakPointExists);
    console.log("Producer:", producerNodeId, "exists:", producerExists);
  });
  const styledEdges = applyEdgeStyling(edges);

  return {
    nodes: [...nodes, ...targetSinkNodes] as (
      | FlowProductionNode
      | FlowTargetNode
    )[],
    edges: styledEdges,
  };
}
