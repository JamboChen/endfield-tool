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

  // Perform layout and styling asynchronously when plan or visualization mode changes
  useEffect(() => {
    let isMounted = true;

    async function computeLayout() {
      if (!plan || plan.dependencyRootNodes.length === 0) {
        setNodes([]);
        setEdges([]);
        return;
      }

      // Select mapper and pass plan for optimization data
      const flowData =
        visualizationMode === "separated"
          ? mapPlanToFlowSeparated(plan.dependencyRootNodes, items, facilities)
          : mapPlanToFlowMerged(plan.dependencyRootNodes, items, facilities);
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        await getLayoutedElements(flowData.nodes, flowData.edges, "RIGHT");

      if (!isMounted) return;

      const styledEdges = applyEdgeStyling(layoutedEdges, layoutedNodes);

      setNodes(layoutedNodes as FlowProductionNode[]);
      setEdges(styledEdges);
    }

    computeLayout();

    return () => {
      isMounted = false;
    };
  }, [plan, items, facilities, visualizationMode, setNodes, setEdges]);

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
