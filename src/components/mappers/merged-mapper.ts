import { Position } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import type {
  Item,
  Facility,
  ProductionNode,
  FlowNodeData,
  FlowProductionNode,
  FlowTargetNode,
} from "@/types";
import type {} from "@/lib/calculator";
import {
  createFlowNodeKey,
  aggregateProductionNodes,
  findTargetsWithDownstream,
  createEdge,
} from "../flow/flow-utils";

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
  keyToLevel?: Map<string, number>,
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];
  const nodeKeyToId = new Map<string, string>();
  const targetSinkNodes: FlowTargetNode[] = [];

  const aggregatedNodes = aggregateProductionNodes(rootNodes);
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
    if (!nodeKeyToId.has(key)) {
      nodeKeyToId.set(key, `node-${key}`);
    }
    return nodeKeyToId.get(key)!;
  };

  const getNodeLevel = (node: ProductionNode, key: string): number => {
    if (node.level !== undefined) return node.level;
    return keyToLevel?.get(key) || 0;
  };

  const traverse = (
    node: ProductionNode,
    parentId: string | null = null,
    edgeIdCounter: { count: number },
  ): string => {
    const nodeId = getOrCreateNodeId(node);
    const key = createFlowNodeKey(node);

    // Handle cycle placeholder
    if (node.isCyclePlaceholder) {
      if (parentId && parentId !== nodeId) {
        edges.push(
          createEdge(
            `e${edgeIdCounter.count++}`,
            nodeId,
            parentId,
            node.targetRate,
          ),
        );
      }
      return nodeId;
    }

    // Skip targets without downstream
    if (node.isTarget && !targetsWithDownstream.has(key)) {
      node.dependencies.forEach((dep) => traverse(dep, null, edgeIdCounter));
      return nodeId;
    }

    // Create production node if not exists
    if (!nodes.find((n) => n.id === nodeId)) {
      const aggregatedData = aggregatedNodes.get(key)!;
      const isDirectTarget = node.isTarget && targetsWithDownstream.has(key);

      nodes.push({
        id: nodeId,
        type: "productionNode",
        data: {
          productionNode: {
            ...aggregatedData.node,
            targetRate: aggregatedData.totalRate,
            facilityCount: aggregatedData.totalFacilityCount,
          },
          items,
          facilities,
          isDirectTarget,
          directTargetRate: isDirectTarget
            ? aggregatedData.totalRate
            : undefined,
          level: getNodeLevel(aggregatedData.node, key),
        },
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    }

    // Create edge to parent
    if (parentId && parentId !== nodeId) {
      const edgeExists = edges.some(
        (e) => e.source === nodeId && e.target === parentId,
      );

      if (!edgeExists) {
        edges.push(
          createEdge(
            `e${edgeIdCounter.count++}`,
            nodeId,
            parentId,
            node.targetRate,
          ),
        );
      }
    }

    node.dependencies.forEach((dep) => traverse(dep, nodeId, edgeIdCounter));
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
        ),
      );
    } else {
      edges.push(
        ...createTargetDependencyEdges(
          data.node,
          targetNodeId,
          data.totalRate,
          getOrCreateNodeId,
          edgeIdCounter,
        ),
      );
    }
  });

  return {
    nodes: [...nodes, ...targetSinkNodes] as (
      | FlowProductionNode
      | FlowTargetNode
    )[],
    edges: edges,
  };
}

/**
 * Helper: Creates edges for target dependencies
 */
function createTargetDependencyEdges(
  targetNode: ProductionNode,
  targetNodeId: string,
  totalRate: number,
  getOrCreateNodeId: (node: ProductionNode) => string,
  edgeIdCounter: { count: number },
): Edge[] {
  const edges: Edge[] = [];
  const recipe = targetNode.recipe;
  if (!recipe) return edges;

  targetNode.dependencies.forEach((dep) => {
    const depNodeId = getOrCreateNodeId(dep);
    const inputItem = recipe.inputs.find((inp) => inp.itemId === dep.item.id);
    const outputItem = recipe.outputs.find(
      (out) => out.itemId === targetNode.item.id,
    );

    if (!inputItem || !outputItem) return;

    const flowRate = (inputItem.amount / outputItem.amount) * totalRate;
    edges.push(
      createEdge(
        `e${edgeIdCounter.count++}`,
        depNodeId,
        targetNodeId,
        flowRate,
      ),
    );
  });

  return edges;
}
