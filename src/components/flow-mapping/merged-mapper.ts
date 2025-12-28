import { Position, MarkerType } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import type { Item, Facility } from "@/types";
import type { ProductionNode, DetectedCycle } from "@/lib/calculator";
import type {
  FlowNodeData,
  FlowProductionNode,
  FlowTargetNode,
  CycleNodeData,
} from "./types";
import { applyEdgeStyling } from "./edge-styling";
import {
  createFlowNodeKey,
  aggregateProductionNodes,
  makeNodeIdFromKey,
  findTargetsWithDownstream,
  createCycleInfo,
  calculateCycleFacilityCount,
  calculateCyclePowerConsumption,
  makeCycleNodeId,
} from "./flow-utils";

/**
 * Maps a UnifiedProductionPlan to React Flow nodes and edges in merged mode.
 *
 * In merged mode, identical production steps are combined into single nodes
 * showing aggregated facility counts and production rates. Production cycles
 * are collapsed into single cycle nodes.
 *
 * @param rootNodes The root ProductionNodes of the dependency tree
 * @param items All available items in the game
 * @param facilities All available facilities in the game
 * @param detectedCycles Detected production cycles to collapse
 * @returns An object containing the generated React Flow nodes and edges
 */
export function mapPlanToFlowMerged(
  rootNodes: ProductionNode[],
  items: Item[],
  facilities: Facility[],
  detectedCycles: DetectedCycle[] = [],
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData | CycleNodeData>[] = [];
  const edges: Edge[] = [];
  const nodeKeyToId = new Map<string, string>();
  const targetSinkNodes: Node<import("./types").TargetSinkNodeData>[] = [];

  const aggregatedNodes = aggregateProductionNodes(rootNodes);
  const itemMap = new Map(items.map((item) => [item.id, item]));

  // Identify which targets are upstream of other targets
  const targetsWithDownstream = findTargetsWithDownstream(rootNodes);

  // Create a set of all item IDs that are part of cycles
  const cycleItemIds = new Set<import("@/types").ItemId>();
  const itemIdToCycleId = new Map<import("@/types").ItemId, string>();

  detectedCycles.forEach((cycle) => {
    cycle.involvedItemIds.forEach((itemId) => {
      cycleItemIds.add(itemId);
      itemIdToCycleId.set(itemId, cycle.cycleId);
    });
  });

  // Create cycle nodes
  const cycleNodeIds = new Map<string, string>(); // cycleId -> nodeId

  detectedCycles.forEach((cycle) => {
    const cycleNodeId = makeCycleNodeId(cycle.cycleId);
    cycleNodeIds.set(cycle.cycleId, cycleNodeId);

    const totalFacilityCount = calculateCycleFacilityCount(cycle);
    const totalPowerConsumption = calculateCyclePowerConsumption(cycle);

    nodes.push({
      id: cycleNodeId,
      type: "cycleNode",
      data: {
        cycle,
        items,
        facilities,
        totalFacilityCount,
        totalPowerConsumption,
      },
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
  });

  const getOrCreateNodeId = (node: ProductionNode): string => {
    // If node is part of a cycle, return the cycle node ID
    if (cycleItemIds.has(node.item.id)) {
      const cycleId = itemIdToCycleId.get(node.item.id)!;
      return cycleNodeIds.get(cycleId)!;
    }

    // Otherwise, create or return regular node ID
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

    // If this node is part of a cycle, don't create an individual node
    if (cycleItemIds.has(node.item.id)) {
      const cycleId = itemIdToCycleId.get(node.item.id)!;
      const cycleNodeId = cycleNodeIds.get(cycleId)!;

      // Create edge from cycle node to parent if parent exists
      if (parentId && parentId !== cycleNodeId) {
        const flowRate = node.targetRate;

        const edgeExists = edges.some(
          (e) => e.source === cycleNodeId && e.target === parentId,
        );

        if (!edgeExists) {
          const edgeId = `e${edgeIdCounter.count++}`;
          edges.push({
            id: edgeId,
            source: cycleNodeId,
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

      // Process dependencies
      node.dependencies.forEach((dep) => {
        if (!cycleItemIds.has(dep.item.id)) {
          // Dependency is outside the cycle, connect it to the cycle node
          traverse(dep, cycleNodeId, edgeIdCounter);
        }
        // If dependency is inside cycle, skip (already handled by cycle node)
      });

      return cycleNodeId;
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

      // Generate cycle info for this node (will be undefined for non-cycle nodes)
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
      // Target with downstream: check if it's a cycle or regular node
      const nodeId = cycleItemIds.has(data.node.item.id)
        ? cycleNodeIds.get(itemIdToCycleId.get(data.node.item.id)!)!
        : makeNodeIdFromKey(key);

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
