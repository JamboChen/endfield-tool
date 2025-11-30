import { useMemo, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MarkerType,
  Position,
  type NodeTypes,
  BackgroundVariant,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Item, Facility } from "@/types";
import type { UnifiedProductionPlan, ProductionNode } from "@/lib/calculator";
import CustomProductionNode, {
  type FlowNodeData,
  type FlowProductionNode,
} from "./CustomProductionNode";
import { useTranslation } from "react-i18next";
import { getLayoutedElements } from "@/lib/layout";

/**
 * Creates a stable key for a ProductionNode.
 * This key is used to identify and merge nodes that represent the same item, recipe, and raw material status.
 * @param node The ProductionNode to create a key for.
 * @returns A unique string key for the node.
 */
const createFlowNodeKey = (node: ProductionNode): string => {
  const itemId = node.item.id;
  const recipeId = node.recipe?.id ?? "raw";
  const rawFlag = node.isRawMaterial ? "raw" : "prod";
  return `${itemId}__${recipeId}__${rawFlag}`;
};

/**
 * Maps a UnifiedProductionPlan to React Flow nodes and edges.
 * This function traverses the dependency tree to create a visual representation
 * of the production process.
 * @param rootNodes The root ProductionNodes of the dependency tree.
 * @param items All available items in the game.
 * @param facilities All available facilities in the game.
 * @returns An object containing the generated React Flow nodes and edges.
 */
const mapPlanToFlow = (
  rootNodes: ProductionNode[],
  items: Item[],
  facilities: Facility[],
): { nodes: FlowProductionNode[]; edges: Edge[] } => {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];
  const nodeKeyToId = new Map<string, string>();
  const nodeIdToRepresentativeNode = new Map<string, ProductionNode>();
  const flowRates: number[] = [];

  /**
   * Generates a stable and readable node ID from a given key.
   * A prefix is added to avoid collisions with other ID formats.
   * @param key The unique key generated for a ProductionNode.
   * @returns A formatted node ID.
   */
  const makeNodeIdFromKey = (key: string) => `node-${key}`;

  /**
   * Retrieves an existing node ID or creates a new one if the node hasn't been encountered before.
   * This ensures that nodes representing the same production entity share the same ID.
   * @param node The ProductionNode for which to get or create an ID.
   * @returns The unique ID for the node.
   */
  const getOrCreateNodeId = (node: ProductionNode): string => {
    const key = createFlowNodeKey(node);
    if (nodeKeyToId.has(key)) {
      return nodeKeyToId.get(key)!;
    }
    const nodeId = makeNodeIdFromKey(key);
    nodeKeyToId.set(key, nodeId);
    nodeIdToRepresentativeNode.set(nodeId, node);
    return nodeId;
  };

  /**
   * Recursively traverses the production dependency tree to create nodes and edges for React Flow.
   * @param node The current ProductionNode being processed.
   * @param parentId The ID of the parent node in the flow graph, or null if it's a root node.
   * @param edgeIdCounter An object to keep track of unique edge IDs.
   * @returns The ID of the current node.
   */
  const traverse = (
    node: ProductionNode,
    parentId: string | null = null,
    edgeIdCounter: { count: number },
  ): string => {
    const nodeId = getOrCreateNodeId(node);

    // If the node isn't yet in the nodes array, add it using the representative node (the first encountered instance)
    if (!nodes.find((n) => n.id === nodeId)) {
      const repNode = nodeIdToRepresentativeNode.get(nodeId) || node;
      const isCircular = repNode.isRawMaterial && repNode.recipe !== null;

      nodes.push({
        id: nodeId,
        type: "productionNode",
        data: {
          productionNode: repNode,
          isCircular,
          items,
          facilities,
        },
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    }

    // Create an edge if a parent exists
    if (parentId) {
      const flowRate = node.targetRate;
      flowRates.push(flowRate);

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

  const edgeIdCounter = { count: 0 };
  rootNodes.forEach((root) => traverse(root, null, edgeIdCounter));

  // Apply dynamic styling to edges based on flow rates for better visual representation
  if (flowRates.length > 0) {
    const maxFlow = Math.max(...flowRates);
    const minFlow = Math.min(...flowRates);
    const flowRange = maxFlow - minFlow || 1; // Prevent division by zero

    const fixedMarkerSize = 8; // Define fixed arrow size

    edges.forEach((edge) => {
      const flowRate =
        (edge.data as { flowRate?: number } | undefined)?.flowRate ?? 0;
      const normalizedFlow = (flowRate - minFlow) / flowRange;

      // 1. Non-linear width mapping (using square root for smoother transition)
      const minWidth = 2;
      const maxWidth = 8;
      const strokeWidth =
        minWidth + Math.sqrt(normalizedFlow) * (maxWidth - minWidth);

      // 2. Color calculation: Lightness (45-85) and Saturation (70-95) for HSL color
      const minLightness = 45;
      const maxLightness = 85;
      const lightness =
        minLightness + normalizedFlow * (maxLightness - minLightness);

      const minSaturation = 70;
      const maxSaturation = 95;
      const saturation =
        minSaturation +
        Math.sqrt(normalizedFlow) * (maxSaturation - minSaturation);

      const edgeColor = `hsl(217, ${saturation}%, ${lightness}%)`;

      // 3. Apply fixed arrow size and color
      edge.style = {
        strokeWidth,
        stroke: edgeColor,
      };
      edge.markerEnd = {
        type: MarkerType.ArrowClosed,
        color: edgeColor,
        width: fixedMarkerSize,
        height: fixedMarkerSize,
      };

      // 4. Improve label readability with fixed font size and better contrast
      edge.labelStyle = {
        fontSize: 11,
        fontWeight: 600,
        fill: edgeColor,
      };
      edge.labelBgStyle = {
        fill: "white",
        fillOpacity: 0.9,
      };
    });
  }

  return {
    nodes: nodes as FlowProductionNode[],
    edges,
  };
};

/**
 * Props for the ProductionDependencyTree component.
 */
type ProductionDependencyTreeProps = {
  plan: UnifiedProductionPlan | null;
  items: Item[];
  facilities: Facility[];
};

/**
 * ProductionDependencyTree component displays a React Flow graph of production dependencies.
 * It takes a production plan and visualizes it with custom nodes and styled edges.
 * @param {ProductionDependencyTreeProps} props The component props.
 * @returns A React Flow component displaying the production dependency tree.
 */
export default function ProductionDependencyTree({
  plan,
  items,
  facilities,
}: ProductionDependencyTreeProps) {
  const { t } = useTranslation("production");

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!plan || plan.dependencyRootNodes.length === 0) {
      return { initialNodes: [] as FlowProductionNode[], initialEdges: [] };
    }
    const flowData = mapPlanToFlow(plan.dependencyRootNodes, items, facilities);

    // Apply layout algorithm to position nodes
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      flowData.nodes,
      flowData.edges,
      "LR",
    );
    return {
      initialNodes: layoutedNodes as FlowProductionNode[],
      initialEdges: layoutedEdges,
    };
  }, [plan, items, facilities]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowProductionNode>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Update React Flow's internal state when initial nodes/edges change
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Define custom node types for React Flow
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      productionNode: CustomProductionNode,
    }),
    [],
  );

  // Display a message if no production plan is available
  if (!plan || plan.dependencyRootNodes.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
        {t("tree.noTarget")}
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{
            padding: 0.2,
            minZoom: 0.1,
            maxZoom: 1.5,
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
