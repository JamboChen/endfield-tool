import { Position, MarkerType } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import type { Item, Facility, ItemId } from "@/types";
import type { ProductionNode, DetectedCycle } from "@/lib/calculator";
import type { FlowNodeData, FlowProductionNode, FlowTargetNode } from "./types";
import { applyEdgeStyling } from "./edge-styling";
import {
  createFlowNodeKey,
  aggregateProductionNodes,
  findTargetsWithDownstream,
  createCycleInfo,
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

  const getOrCreateNodeId = (node: ProductionNode): string => {
    if (node.isCyclePlaceholder && node.cycleItemId) {
      const productionKey = Array.from(aggregatedNodes.keys()).find((key) => {
        const parts = key.split("__");
        return parts[0] === node.cycleItemId && parts[2] === "prod";
      });

      if (productionKey) {
        if (!nodeKeyToId.has(productionKey)) {
          nodeKeyToId.set(productionKey, `node-${productionKey}`);
        }
        return nodeKeyToId.get(productionKey)!;
      }
    }

    const key = createFlowNodeKey(node);
    if (nodeKeyToId.has(key)) {
      return nodeKeyToId.get(key)!;
    }
    const nodeId = `node-${key}`;
    nodeKeyToId.set(key, nodeId);
    return nodeId;
  };

  const getNodeLevel = (node: ProductionNode, key: string): number => {
    if (node.level !== undefined) return node.level;
    return keyToLevel?.get(key) || 0;
  };

  const traverse = (
    node: ProductionNode,
    parentId: string | null = null,
    edgeIdCounter: { count: number },
    parentKey?: string,
  ): string => {
    const nodeId = getOrCreateNodeId(node);
    const key = createFlowNodeKey(node);

    if (node.isCyclePlaceholder) {
      if (parentId && parentId !== nodeId) {
        const flowRate = node.targetRate;
        const edgeExists = edges.some(
          (e) => e.source === nodeId && e.target === parentId,
        );

        if (!edgeExists) {
          const sourceLevel = getNodeLevel(node, key);
          const targetLevel = parentKey
            ? getNodeLevel(node, parentKey)
            : sourceLevel;
          const handlePositions = determineHandlePositions(
            sourceLevel,
            targetLevel,
            true,
          );

          edges.push(
            createEdge(
              `e${edgeIdCounter.count++}`,
              nodeId,
              parentId,
              flowRate,
              {
                isPartOfCycle: true,
                ...handlePositions,
              },
            ),
          );
        }
      }
      return nodeId;
    }

    // 内联 shouldSkipNode
    const isTargetWithoutDownstream =
      node.isTarget && !targetsWithDownstream.has(key);

    if (isTargetWithoutDownstream) {
      node.dependencies.forEach((dep) => traverse(dep, null, edgeIdCounter));
      return nodeId;
    }

    if (!nodes.find((n) => n.id === nodeId)) {
      const aggregatedData = aggregatedNodes.get(key)!;
      const isCircular = node.isRawMaterial && node.recipe !== null;
      const isDirectTarget = node.isTarget && targetsWithDownstream.has(key);

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
          directTargetRate: isDirectTarget
            ? aggregatedData.totalRate
            : undefined,
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
        const isPartOfCycle = isEdgePartOfCycle(
          node.item.id,
          parentId,
          nodeKeyToId,
          detectedCycles,
        );
        const sourceLevel = getNodeLevel(node, key);
        const targetLevel = parentKey
          ? getNodeLevel(node, parentKey)
          : sourceLevel;
        const handlePositions = determineHandlePositions(
          sourceLevel,
          targetLevel,
          isPartOfCycle,
        );

        edges.push(
          createEdge(`e${edgeIdCounter.count++}`, nodeId, parentId, flowRate, {
            isPartOfCycle,
            ...handlePositions,
          }),
        );
      }
    }

    node.dependencies.forEach((dep) =>
      traverse(dep, nodeId, edgeIdCounter, key),
    );
    return nodeId;
  };

  const edgeIdCounter = { count: 0 };
  rootNodes.forEach((root) => traverse(root, null, edgeIdCounter));

  // Create target sink nodes
  const targetNodes = Array.from(aggregatedNodes.entries()).filter(
    ([, data]) => data.node.isTarget && !data.node.isRawMaterial,
  );

  targetNodes.forEach(([key, data]) => {
    const targetNodeId = `target-sink-${data.node.item.id}`;
    const hasDownstream = targetsWithDownstream.has(key);

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
      const nodeId = `node-${key}`;
      edges.push(
        createEdge(
          `e${edgeIdCounter.count++}`,
          nodeId,
          targetNodeId,
          data.totalRate,
          {
            animated: true,
            style: { stroke: "#10b981", strokeWidth: 2 },
          },
        ),
      );
    } else {
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

        const flowRate =
          (inputItem.amount / outputItem.amount) * data.totalRate;
        edges.push(
          createEdge(
            `e${edgeIdCounter.count++}`,
            depNodeId,
            targetNodeId,
            flowRate,
            {
              animated: true,
              style: { stroke: "#10b981", strokeWidth: 2 },
            },
          ),
        );
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

function isEdgePartOfCycle(
  sourceItemId: ItemId,
  targetNodeId: string,
  nodeKeyToId: Map<string, string>,
  detectedCycles: DetectedCycle[],
): boolean {
  const sourceCycle = detectedCycles.find((c) =>
    c.involvedItemIds.includes(sourceItemId),
  );
  if (!sourceCycle) return false;

  for (const [key, nodeId] of nodeKeyToId.entries()) {
    if (nodeId === targetNodeId) {
      const targetItemId = key.split("__")[0] as ItemId;
      return sourceCycle.involvedItemIds.includes(targetItemId);
    }
  }
  return false;
}

function determineHandlePositions(
  sourceLevel: number,
  targetLevel: number,
  isPartOfCycle: boolean,
) {
  const levelDiff = Math.abs(sourceLevel - targetLevel);

  if (isPartOfCycle && levelDiff <= 1) {
    return {
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      sourceHandle: "bottom",
      targetHandle: "top",
    };
  }

  return {
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    sourceHandle: "right",
    targetHandle: "left",
  };
}

// 新增：统一的边创建函数
function createEdge(
  id: string,
  source: string,
  target: string,
  flowRate: number,
  options: {
    isPartOfCycle?: boolean;
    animated?: boolean;
    style?: React.CSSProperties;
    sourceHandle?: string;
    targetHandle?: string;
  } = {},
): Edge {
  return {
    id,
    source,
    target,
    type: "default",
    label: `${flowRate.toFixed(2)} /min`,
    data: {
      flowRate,
      isPartOfCycle: options.isPartOfCycle,
    },
    sourceHandle: options.sourceHandle,
    targetHandle: options.targetHandle,
    animated: options.animated,
    style: options.style,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: options.style?.stroke as string,
    },
  };
}
