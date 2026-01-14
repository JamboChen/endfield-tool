import { type Node, type Edge, Position } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

const nodeWidth = 220;
const nodeHeight = 110;

/**
 * Lays out React Flow elements using the ELK algorithm.
 * ELK provides better handling of hierarchy and complex cycles than Dagre.
 */
export const getLayoutedElements = async (
  nodes: Node[],
  edges: Edge[],
  direction = "RIGHT",
) => {
  const isHorizontal = direction === "RIGHT" || direction === "LEFT";

  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.layered.spacing.nodeNodeBetweenLayers": "150",
      "elk.spacing.nodeNode": "100",
      // Crossing minimization and flow optimization
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.priority.direction": "1",
      "elk.edgeRouting": "SPLINES",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.unnecessaryBendpoints": "true",
      "org.eclipse.elk.padding": "[top=40,left=40,bottom=40,right=40]",
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: nodeWidth,
      height: nodeHeight,
    })),
    edges: edges.map((edge) => {
      const isBackward = edge.type === "backwardEdge" || edge.data?.direction === "backward";

      return {
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
        layoutOptions: {
          // Backward edges (cycles) should be ignored for layering to avoid pulling nodes
          "elk.layered.priority.direction": isBackward ? "-10" : "10",
        },
      };
    }),
  };

  try {
    const layoutedGraph = await elk.layout(elkGraph);

    const layoutedNodes = nodes.map((node) => {
      const elkNode = layoutedGraph.children?.find((n) => n.id === node.id);

      if (!elkNode) return node;

      return {
        ...node,
        position: {
          x: elkNode.x || 0,
          y: elkNode.y || 0,
        },
        targetPosition: isHorizontal ? Position.Left : Position.Top,
        sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      };
    });

    return { nodes: layoutedNodes, edges };
  } catch (error) {
    console.error("ELK layout failed:", error);
    return { nodes, edges };
  }
};
