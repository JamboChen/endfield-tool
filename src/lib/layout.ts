import { type Node, type Edge, Position } from "@xyflow/react";
import dagre from "dagre";

const nodeWidth = 220;
const nodeHeight = 110;

/**
 * Lays out React Flow elements (nodes and edges) using the Dagre algorithm.
 * This function calculates optimal positions for nodes to create a clear
 * and organized dependency graph.
 * @param nodes An array of React Flow nodes.
 * @param edges An array of React Flow edges.
 * @param direction The layout direction, "TB" for top-bottom or "LR" for left-right.
 * @returns An object containing the layouted nodes and original edges.
 */
export const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction = "TB",
) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === "LR";

  // Configure Dagre graph settings
  dagreGraph.setGraph({
    rankdir: direction, // Graph direction (e.g., "LR" for left-to-right)
    ranksep: 80, // Minimum separation between ranks
    nodesep: 40, // Minimum separation between nodes in the same rank
    marginx: 20, // Margin around the graph
    marginy: 20, // Margin around the graph
  });

  // Set nodes in the Dagre graph with predefined width and height
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  // Set edges in the Dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Execute the Dagre layout algorithm
  dagre.layout(dagreGraph);

  // Map Dagre's calculated positions back to React Flow nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    if (!nodeWithPosition) {
      return node; // Return original node if Dagre didn't process it (shouldn't happen)
    }

    return {
      ...node,
      position: {
        // Adjust position to be top-left corner as required by React Flow
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
      // Set target and source handle positions based on layout direction
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
    };
  });

  return { nodes: layoutedNodes, edges };
};
