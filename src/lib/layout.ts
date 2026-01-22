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

// Cache the elk instance or the promise of its loading
let elkInstance: { layout: (graph: ElkGraph) => Promise<ElkNode> } | null =
  null;
let elkPromise: Promise<{
  layout: (graph: ElkGraph) => Promise<ElkNode>;
}> | null = null;

/**
 * Initiates the loading of ELKJS.
 * This can be called early to preload the 1.4MB bundle in the background.
 */
export const preloadLayoutEngine = () => {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled.js").then(
      (m) => new m.default(),
    );
  }
  return elkPromise;
};

// Start preloading immediately when this utility module is imported
preloadLayoutEngine();

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
  // Ensure the engine is loaded (either already cached or waiting for the preload promise)
  if (!elkInstance) {
    elkInstance = await preloadLayoutEngine();
  }

  const isHorizontal = direction === "RIGHT" || direction === "LEFT";

  const elkGraph: ElkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.layered.spacing.nodeNodeBetweenLayers": "150",
      "elk.spacing.nodeNode": "100",
      "elk.edgeRouting": "SPLINES",
      "elk.layered.feedbackEdges": "true",
      "elk.layered.nodePlacement.favorStraightEdges": "0.2",
      "elk.layered.unnecessaryBendpoints": "true",
      "org.eclipse.elk.padding": "[top=40,left=40,bottom=40,right=40]",
    },
    children: nodes.map((node) => {
      return {
        id: node.id,
        width: node.measured?.width,
        height: node.measured?.height,
      };
    }),
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
