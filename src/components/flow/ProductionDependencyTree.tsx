import { useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  type NodeTypes,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Edge,
  useNodesInitialized,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  Item,
  Facility,
  FlowProductionNode,
  VisualizationMode,
  ProductionDependencyGraph,
} from "@/types";
import CustomProductionNode from "../nodes/CustomProductionNode";
import CustomTargetNode from "../nodes/CustomTargetNode";
import { useTranslation } from "react-i18next";
import { getLayoutedElements } from "@/lib/layout";
import { mapPlanToFlowMerged } from "../mappers/merged-mapper";
import { mapPlanToFlowSeparated } from "../mappers/separated-mapper";
import { applyEdgeStyling } from "./flow-utils";
import CustomBackwardEdge from "../nodes/CustomBackwardEdge";

/**
 * Props for the ProductionDependencyTree component.
 */
type ProductionDependencyTreeProps = {
  plan: ProductionDependencyGraph | null;
  items: Item[];
  facilities: Facility[];
  /** Visualization mode: 'merged' shows aggregated facilities, 'separated' shows individual facilities */
  visualizationMode?: VisualizationMode;
};

/**
 * ProductionDependencyTree component displays a React Flow graph of production dependencies.
 *
 * It supports two visualization modes:
 * - Merged: Combines identical production steps and shows aggregated facility counts
 * - Separated: Shows each individual facility as a separate node for detailed planning
 *
 * The component automatically layouts nodes using the Dagre algorithm and applies
 * dynamic styling to edges based on material flow rates and geometry.
 *
 * @param {ProductionDependencyTreeProps} props The component props
 * @returns A React Flow component displaying the production dependency tree
 */
export default function ProductionDependencyTree({
  plan,
  items,
  facilities,
  visualizationMode = "separated",
}: ProductionDependencyTreeProps) {
  const { t } = useTranslation("production");

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowProductionNode>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const nodesInitialized = useNodesInitialized();
  const layoutDoneRef = useRef(false);

  // Track previous graph signature and node positions
  const prevSignatureRef = useRef<string>("");
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );

  // Perform layout and styling asynchronously when plan or visualization mode changes
  useEffect(() => {
    if (!plan || plan.dependencyRootNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      prevSignatureRef.current = "";
      nodePositionsRef.current.clear();
      return;
    }

    const flowData =
      visualizationMode === "separated"
        ? mapPlanToFlowSeparated(plan.dependencyRootNodes, items, facilities)
        : mapPlanToFlowMerged(plan.dependencyRootNodes, items, facilities);

    // Generate structural signature
    const newSignature = generateGraphSignature(flowData.nodes, flowData.edges);
    const isStructuralChange = newSignature !== prevSignatureRef.current;

    if (isStructuralChange) {
      // Structural change: need to re-layout
      setNodes(flowData.nodes as FlowProductionNode[]);
      setEdges(flowData.edges);
      layoutDoneRef.current = false;
      prevSignatureRef.current = newSignature;
    } else {
      // Data-only change: preserve positions and re-apply edge styling
      const nodesWithPositions = flowData.nodes.map((node) => {
        const savedPosition = nodePositionsRef.current.get(node.id);
        return savedPosition ? { ...node, position: savedPosition } : node;
      }) as FlowProductionNode[];

      // Apply edge styling with preserved node positions
      const styledEdges = applyEdgeStyling(flowData.edges, nodesWithPositions);

      setNodes(nodesWithPositions);
      setEdges(styledEdges);
      // Keep layoutDoneRef.current as true to skip re-layout
    }
  }, [plan, items, facilities, visualizationMode, setNodes, setEdges]);

  useEffect(() => {
    if (!nodesInitialized || layoutDoneRef.current) return;

    layoutDoneRef.current = true;

    (async () => {
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        await getLayoutedElements(nodes, edges, "RIGHT");

      const styledEdges = applyEdgeStyling(layoutedEdges, layoutedNodes);

      // Save node positions
      layoutedNodes.forEach((node) => {
        nodePositionsRef.current.set(node.id, node.position);
      });

      setNodes(layoutedNodes as FlowProductionNode[]);
      setEdges(styledEdges);
    })();
  }, [nodesInitialized, nodes, edges, setNodes, setEdges]);

  // Define custom node types for React Flow
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      productionNode: CustomProductionNode,
      targetSink: CustomTargetNode,
    }),
    [],
  );

  // Define custom edge types for React Flow
  const edgeTypes = useMemo(
    () => ({
      backwardEdge: CustomBackwardEdge,
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
          edgeTypes={edgeTypes}
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

/**
 * Generates a structural signature for the graph based on nodes and edges.
 * Only changes when nodes are added/removed or connections change.
 * Does NOT change when node data (like targetRate) changes.
 */
function generateGraphSignature(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string }>,
): string {
  const nodeIds = nodes
    .map((n) => n.id)
    .sort()
    .join(",");
  const edgeConnections = edges
    .map((e) => `${e.source}->${e.target}`)
    .sort()
    .join(";");
  return `nodes:${nodeIds}|edges:${edgeConnections}`;
}
