import { MarkerType, type Edge, type EdgeData } from "@xyflow/react";

/**
 * Applies dynamic styling to edges based on their flow rates.
 *
 * This creates a visual hierarchy where higher-throughput connections are
 * more prominent (thicker, more saturated) than lower-throughput ones.
 *
 * The styling includes:
 * - Non-linear width scaling (using square root for smoother transitions)
 * - HSL color variation (lightness and saturation)
 * - Fixed arrow size for consistency
 * - Enhanced label readability
 *
 * @param edges Array of edges to style
 * @returns The same edges array with style properties applied
 */
export function applyEdgeStyling(edges: Edge[]): Edge[] {
  if (edges.length === 0) return edges;

  // Find max flow rate for normalization (excluding target sink edges)
  const flowRates: number[] = [];

  edges.forEach((e) => {
    const data = e.data as EdgeData | undefined;
    if (data?.flowRate !== undefined && !e.animated) {
      flowRates.push(data.flowRate);
    }
  });

  const maxFlowRate = Math.max(...flowRates, 1);

  return edges.map((edge) => {
    // Skip edges that already have custom styling (like target sink edges)
    if (edge.animated && edge.style?.stroke === "#10b981") {
      return edge;
    }

    const data = edge.data as EdgeData | undefined;

    // Return unchanged if no valid data
    if (!data || typeof data.flowRate !== "number") {
      return edge;
    }

    const flowRate = data.flowRate;
    const isPartOfCycle = data.isPartOfCycle || false;

    // Calculate stroke width based on flow rate (1-4 range)
    const normalizedRate = flowRate / maxFlowRate;
    const strokeWidth = 1 + normalizedRate * 3;

    // Apply cycle styling
    if (isPartOfCycle) {
      return {
        ...edge,
        animated: true,
        style: {
          strokeWidth,
          stroke: "#a855f7", // Purple color for cycle edges
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#a855f7",
        },
      };
    }

    // Regular edge styling
    return {
      ...edge,
      style: {
        strokeWidth,
        stroke: "#64748b", // Default gray
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#64748b",
      },
    };
  });
}
