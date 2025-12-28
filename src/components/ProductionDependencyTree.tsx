import { useMemo, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  type NodeTypes,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Item, Facility } from "@/types";
import type { UnifiedProductionPlan } from "@/lib/calculator";
import CustomProductionNode from "./tree-node/CustomProductionNode";
import CustomTargetNode from "./tree-node/CustomTargetNode";
import type {
  FlowProductionNode,
  VisualizationMode,
} from "./flow-mapping/types";
import { useTranslation } from "react-i18next";
import { getLayoutedElements } from "@/lib/layout";
import { mapPlanToFlowMerged } from "./flow-mapping/merged-mapper";
import { mapPlanToFlowSeparated } from "./flow-mapping/separated-mapper";

/**
 * Props for the ProductionDependencyTree component.
 */
type ProductionDependencyTreeProps = {
  plan: UnifiedProductionPlan | null;
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
 * dynamic styling to edges based on material flow rates.
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

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!plan || plan.dependencyRootNodes.length === 0) {
      return { initialNodes: [] as FlowProductionNode[], initialEdges: [] };
    }

    // Select the appropriate mapper based on visualization mode
    const flowData =
      visualizationMode === "separated"
        ? mapPlanToFlowSeparated(
            plan.dependencyRootNodes,
            items,
            facilities,
            plan.detectedCycles,
          )
        : mapPlanToFlowMerged(
            plan.dependencyRootNodes,
            items,
            facilities,
            plan.detectedCycles,
          );

    // Apply layout algorithm to position nodes
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      flowData.nodes,
      flowData.edges,
      "LR", // Left-to-right layout
    );

    return {
      initialNodes: layoutedNodes as FlowProductionNode[],
      initialEdges: layoutedEdges,
    };
  }, [plan, items, facilities, visualizationMode]);

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
      targetSink: CustomTargetNode,
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
