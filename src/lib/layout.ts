import { type Node, type Edge, Position } from "@xyflow/react";

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  layoutOptions?: Record<string, string>;
}

interface ElkGraph {
  id: string;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: ElkEdge[];
}

// Cache the elk instance to avoid repeated dynamic imports and initializations
let elkInstance: { layout: (graph: ElkGraph) => Promise<ElkNode> } | null =
  null;

const nodeWidth = 220;
const nodeHeight = 110;

/**
 * Lays out React Flow elements using the ELK algorithm.
 * ELK provides better handling of hierarchy and complex cycles than Dagre.
 * This version uses dynamic importing to only load the 1.4MB ELK bundle when needed.
 */
export const getLayoutedElements = async (
  nodes: Node[],
  edges: Edge[],
  direction = "RIGHT",
) => {
  // Dynamically load ELK only when the layout is actually requested
  if (!elkInstance) {
    const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
    elkInstance = new ELK();
  }

  const isHorizontal = direction === "RIGHT" || direction === "LEFT";

  const elkGraph: ElkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.layered.spacing.nodeNodeBetweenLayers": "150",
      "elk.spacing.nodeNode": "100",
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
      const isBackward =
        edge.type === "backwardEdge" || edge.data?.direction === "backward";

      return {
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
        layoutOptions: {
          "elk.layered.priority.direction": isBackward ? "-10" : "10",
        },
      };
    }),
  };

  try {
    const layoutedGraph = await elkInstance!.layout(elkGraph);

    const layoutedNodes = nodes.map((node) => {
      const elkNode = layoutedGraph.children?.find((n) => n.id === node.id);

      if (!elkNode) return node;

      return {
        ...node,
        position: {
          x: elkNode.x ?? 0,
          y: elkNode.y ?? 0,
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
