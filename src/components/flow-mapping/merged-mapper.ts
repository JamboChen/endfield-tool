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
  determineHandlePositions,
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
  keyToLevel?: Map<string, number>,
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];
  const nodeKeyToId = new Map<string, string>();
  const targetSinkNodes: Node<import("./types").TargetSinkNodeData>[] = [];

  const aggregatedNodes = aggregateProductionNodes(rootNodes);
  const itemMap = new Map(items.map((item) => [item.id, item]));

  const targetsWithDownstream = findTargetsWithDownstream(rootNodes);

  const breakPointItemIds = new Set(
    detectedCycles.map((cycle) => cycle.breakPointItemId),
  );

  const itemIdToCycle = new Map<import("@/types").ItemId, DetectedCycle>();
  detectedCycles.forEach((cycle) => {
    cycle.involvedItemIds.forEach((itemId) => {
      itemIdToCycle.set(itemId, cycle);
    });
  });

  const getOrCreateNodeId = (node: ProductionNode): string => {
    if (
      node.isRawMaterial &&
      breakPointItemIds.has(node.item.id) &&
      itemIdToCycle.has(node.item.id)
    ) {
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

    const key = createFlowNodeKey(node);
    if (nodeKeyToId.has(key)) {
      return nodeKeyToId.get(key)!;
    }
    const nodeId = makeNodeIdFromKey(key);
    nodeKeyToId.set(key, nodeId);
    return nodeId;
  };

  // Helper function to get level for a node
  const getNodeLevel = (node: ProductionNode, key: string): number => {
    if (node.level !== undefined) return node.level;
    if (keyToLevel) {
      return keyToLevel.get(key) || 0;
    }
    return 0;
  };

  const traverse = (
    node: ProductionNode,
    parentId: string | null = null,
    edgeIdCounter: { count: number },
    parentKey?: string,
  ): string => {
    const nodeId = getOrCreateNodeId(node);
    const key = createFlowNodeKey(node);

    const isBreakPointRawMaterial =
      node.isRawMaterial &&
      breakPointItemIds.has(node.item.id) &&
      itemIdToCycle.has(node.item.id);

    if (isBreakPointRawMaterial) {
      if (parentId && parentId !== nodeId) {
        const flowRate = node.targetRate;

        const edgeExists = edges.some(
          (e) => e.source === nodeId && e.target === parentId,
        );

        if (!edgeExists) {
          const edgeId = `e${edgeIdCounter.count++}`;

          const isPartOfCycle = isEdgePartOfCycle(
            node.item.id,
            parentId,
            nodeKeyToId,
            detectedCycles,
          );

          // Get levels for handle position determination
          const sourceLevel = getNodeLevel(node, key);
          const targetLevel = parentKey
            ? getNodeLevel(node, parentKey)
            : sourceLevel;

          const handlePositions = determineHandlePositions(
            sourceLevel,
            targetLevel,
            isPartOfCycle,
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
            sourceHandle: handlePositions.sourceHandle,
            targetHandle: handlePositions.targetHandle,
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
          });
        }
      }

      return nodeId;
    }

    const isTargetWithoutDownstream =
      node.isTarget && !targetsWithDownstream.has(key);

    if (isTargetWithoutDownstream) {
      node.dependencies.forEach((dep) => {
        traverse(dep, null, edgeIdCounter);
      });

      return nodeId;
    }

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

      const cycleInfo = createCycleInfo(
        aggregatedData.node,
        detectedCycles,
        itemMap,
      );

      const level = getNodeLevel(aggregatedData.node, key);

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
          level,
        },
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    }

    if (parentId && parentId !== nodeId) {
      const flowRate = node.targetRate;

      const edgeExists = edges.some(
        (e) => e.source === nodeId && e.target === parentId,
      );

      if (!edgeExists) {
        const edgeId = `e${edgeIdCounter.count++}`;

        const isPartOfCycle = isEdgePartOfCycle(
          node.item.id,
          parentId,
          nodeKeyToId,
          detectedCycles,
        );

        // Get levels for handle position determination
        const sourceLevel = getNodeLevel(node, key);
        const targetLevel = parentKey
          ? getNodeLevel(node, parentKey)
          : sourceLevel;

        const handlePositions = determineHandlePositions(
          sourceLevel,
          targetLevel,
          isPartOfCycle,
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
          sourceHandle: handlePositions.sourceHandle,
          targetHandle: handlePositions.targetHandle,
          markerEnd: {
            type: MarkerType.ArrowClosed,
          },
        });
      }
    }

    node.dependencies.forEach((dep) => {
      traverse(dep, nodeId, edgeIdCounter, key);
    });

    return nodeId;
  };

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
