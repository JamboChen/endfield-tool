import { Position, MarkerType } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import type { Item, Facility } from "@/types";
import type { ProductionNode, DetectedCycle } from "@/lib/calculator";
import type { FlowNodeData, FlowProductionNode, FlowTargetNode } from "./types";
import { applyEdgeStyling } from "./edge-styling";
import {
  createFlowNodeKey,
  aggregateProductionNodes,
  makeNodeIdFromKey,
  findTargetsWithDownstream,
  createCycleInfo,
  isEdgePartOfCycle,
} from "./flow-utils";

/**
 * Maps a UnifiedProductionPlan to React Flow nodes and edges in merged mode.
 *
 * In merged mode, identical production steps are combined into single nodes
 * showing aggregated facility counts and production rates. Production cycles
 * are visualized with special edge styling instead of being collapsed.
 *
 * @param rootNodes The root ProductionNodes of the dependency tree
 * @param items All available items in the game
 * @param facilities All available facilities in the game
 * @param detectedCycles Detected production cycles for visual highlighting
 * @returns An object containing the generated React Flow nodes and edges
 */
export function mapPlanToFlowMerged(
  rootNodes: ProductionNode[],
  items: Item[],
  facilities: Facility[],
  detectedCycles: DetectedCycle[] = [],
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];
  const nodeKeyToId = new Map<string, string>();
  const targetSinkNodes: Node<import("./types").TargetSinkNodeData>[] = [];

  const aggregatedNodes = aggregateProductionNodes(rootNodes);
  const itemMap = new Map(items.map((item) => [item.id, item]));

  // Identify which targets are upstream of other targets
  const targetsWithDownstream = findTargetsWithDownstream(rootNodes);

  // Create a set of break point item IDs for quick lookup
  const breakPointItemIds = new Set(
    detectedCycles.map((cycle) => cycle.breakPointItemId),
  );

  // Create a map from item ID to cycle for quick lookup
  const itemIdToCycle = new Map<import("@/types").ItemId, DetectedCycle>();
  detectedCycles.forEach((cycle) => {
    cycle.involvedItemIds.forEach((itemId) => {
      itemIdToCycle.set(itemId, cycle);
    });
  });

  const getOrCreateNodeId = (node: ProductionNode): string => {
    // If this is a break point node (raw material that's actually in a cycle),
    // return the ID of the production node instead
    if (
      node.isRawMaterial &&
      breakPointItemIds.has(node.item.id) &&
      itemIdToCycle.has(node.item.id)
    ) {
      // Find the production node key for this item
      const productionKey = Array.from(aggregatedNodes.keys()).find((key) => {
        const parts = key.split("__");
        return parts[0] === node.item.id && parts[2] === "prod";
      });

      if (productionKey) {
        if (!nodeKeyToId.has(productionKey)) {
          nodeKeyToId.set(productionKey, makeNodeIdFromKey(productionKey));
        }
        return nodeKeyToId.get(productionKey)!;
      }
    }

    // Normal case: create or return regular node ID
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
   */
  const traverse = (
    node: ProductionNode,
    parentId: string | null = null,
    edgeIdCounter: { count: number },
  ): string => {
    const nodeId = getOrCreateNodeId(node);
    const key = createFlowNodeKey(node);

    // Skip creating a separate node for break point raw materials
    // as they will be connected to their production node counterpart
    const isBreakPointRawMaterial =
      node.isRawMaterial &&
      breakPointItemIds.has(node.item.id) &&
      itemIdToCycle.has(node.item.id);

    if (isBreakPointRawMaterial) {
      // Create edge to parent if parent exists
      if (parentId && parentId !== nodeId) {
        const flowRate = node.targetRate;

        const edgeExists = edges.some(
          (e) => e.source === nodeId && e.target === parentId,
        );

        if (!edgeExists) {
          const edgeId = `e${edgeIdCounter.count++}`;

          // This edge connects back to the cycle, so mark it as part of cycle
          const isPartOfCycle = isEdgePartOfCycle(
            node.item.id,
            parentId,
            nodeKeyToId,
            detectedCycles,
          );

          edges.push({
            id: edgeId,
            source: nodeId,
            target: parentId,
            type: "default",
            label: `${flowRate.toFixed(2)} /min`,
            data: {
              flowRate,
              isPartOfCycle,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
          });
        }
      }

      // Don't traverse dependencies for break point raw materials
      return nodeId;
    }

    // Skip creating production node if it's a target without downstream
    const isTargetWithoutDownstream =
      node.isTarget && !targetsWithDownstream.has(key);

    if (isTargetWithoutDownstream) {
      // Don't create a production node for pure targets
      node.dependencies.forEach((dep) => {
        traverse(dep, null, edgeIdCounter);
      });

      return nodeId;
    }

    // Add node if it doesn't exist yet (regular production node)
    if (!nodes.find((n) => n.id === nodeId)) {
      const aggregatedData = aggregatedNodes.get(key)!;
      const isCircular = node.isRawMaterial && node.recipe !== null;

      const isDirectTarget = node.isTarget && targetsWithDownstream.has(key);
      const directTargetRate = isDirectTarget
        ? aggregatedData.totalRate
        : undefined;

      const aggregatedNode: ProductionNode = {
        ...aggregatedData.node,
        targetRate: aggregatedData.totalRate,
        facilityCount: aggregatedData.totalFacilityCount,
      };

      // Generate cycle info for this node
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
    if (parentId && parentId !== nodeId) {
      const flowRate = node.targetRate;

      const edgeExists = edges.some(
        (e) => e.source === nodeId && e.target === parentId,
      );

      if (!edgeExists) {
        const edgeId = `e${edgeIdCounter.count++}`;

        // Check if this edge is part of a cycle
        const isPartOfCycle = isEdgePartOfCycle(
          node.item.id,
          parentId,
          nodeKeyToId,
          detectedCycles,
        );

        edges.push({
          id: edgeId,
          source: nodeId,
          target: parentId,
          type: "default",
          label: `${flowRate.toFixed(2)} /min`,
          data: {
            flowRate,
            isPartOfCycle,
          },
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
      // Target with downstream: connect from production node
      const nodeId = makeNodeIdFromKey(key);

      edges.push({
        id: `e${edgeIdCounter.count++}`,
        source: nodeId,
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
      // Target without downstream: connect from dependencies
      const targetNode = data.node;

      targetNode.dependencies.forEach((dep) => {
        const depNodeId = getOrCreateNodeId(dep);

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

  const styledEdges = applyEdgeStyling(edges);

  return {
    nodes: [...nodes, ...targetSinkNodes] as (
      | FlowProductionNode
      | FlowTargetNode
    )[],
    edges: styledEdges,
  };
}
