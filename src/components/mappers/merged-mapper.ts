import type { Node, Edge } from "@xyflow/react";
import type {
  Item,
  Facility,
  ProductionDependencyGraph,
  ProductionGraphNode,
  FlowNodeData,
  FlowProductionNode,
  FlowTargetNode,
} from "@/types";
import {
  createEdge,
  createProductionFlowNode,
  createTargetSinkNode,
} from "../flow/flow-utils";
import { createTargetSinkId, createRawMaterialId } from "@/lib/node-keys";
import { calcRate } from "@/lib/utils";

/**
 * Maps a ProductionDependencyGraph to React Flow nodes and edges in merged mode.
 */
export function mapPlanToFlowMerged(
  plan: ProductionDependencyGraph,
  items: Item[],
  facilities: Facility[],
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  const flowNodes: Node<FlowNodeData>[] = [];
  const flowEdges: Edge[] = [];
  const targetSinkNodes: FlowTargetNode[] = [];

  let edgeIdCounter = 0;

  // Create production nodes (recipe nodes only)
  plan.nodes.forEach((node, nodeId) => {
    if (node.type === "recipe") {
      const outputItemId = plan.edges.find((e) => e.from === nodeId)?.to;
      const outputItemNode = outputItemId
        ? (plan.nodes.get(outputItemId) as
          | Extract<ProductionGraphNode, { type: "item" }>
          | undefined)
        : undefined;

      if (outputItemNode) {
        flowNodes.push(
          createProductionFlowNode(
            nodeId,
            {
              item: outputItemNode.item,
              targetRate: outputItemNode.productionRate,
              recipe: node.recipe,
              facility: node.facility,
              facilityCount: node.facilityCount,
              isRawMaterial: false,
              isTarget: outputItemNode.isTarget,
              dependencies: [],
            },
            items,
            facilities,
            {
              isDirectTarget: outputItemNode.isTarget,
              directTargetRate: outputItemNode.isTarget
                ? outputItemNode.productionRate
                : undefined,
            },
          ),
        );
      }
    }
  });

  // Create edges: Recipe → Item → Recipe
  plan.edges.forEach((edge) => {
    const sourceNode = plan.nodes.get(edge.from);
    const targetNode = plan.nodes.get(edge.to);

    if (!sourceNode || !targetNode) return;

    // Recipe → Item (produce)
    if (sourceNode.type === "recipe" && targetNode.type === "item") {
      // Don't create visible edge, just track the relationship
      return;
    }

    // Item → Recipe (consume)
    if (sourceNode.type === "item" && targetNode.type === "recipe") {
      // Find the recipe that produces this item
      const producerRecipeId = Array.from(plan.edges).find(
        (e) => e.to === edge.from && plan.nodes.get(e.from)?.type === "recipe",
      )?.from;

      if (producerRecipeId) {
        // Calculate flow rate
        const inputAmount =
          targetNode.recipe.inputs.find(
            (inp) => inp.itemId === sourceNode.itemId,
          )?.amount || 0;
        const flowRate =
          calcRate(inputAmount, targetNode.recipe.craftingTime) *
          targetNode.facilityCount;

        flowEdges.push(
          createEdge(
            `e${edgeIdCounter++}`,
            producerRecipeId,
            edge.to,
            flowRate,
          ),
        );
      } else if (sourceNode.isRawMaterial) {
        // Raw material → Recipe: create node for raw material
        const rawMaterialNodeId = createRawMaterialId(sourceNode.itemId);

        if (!flowNodes.find((n) => n.id === rawMaterialNodeId)) {
          flowNodes.push(
            createProductionFlowNode(
              rawMaterialNodeId,
              {
                item: sourceNode.item,
                targetRate: sourceNode.productionRate,
                recipe: null,
                facility: null,
                facilityCount: 0,
                isRawMaterial: true,
                isTarget: false,
                dependencies: [],
              },
              items,
              facilities,
              { isDirectTarget: false },
            ),
          );
        }

        const inputAmount =
          targetNode.recipe.inputs.find(
            (inp) => inp.itemId === sourceNode.itemId,
          )?.amount || 0;
        const flowRate =
          calcRate(inputAmount, targetNode.recipe.craftingTime) *
          targetNode.facilityCount;

        flowEdges.push(
          createEdge(
            `e${edgeIdCounter++}`,
            rawMaterialNodeId,
            edge.to,
            flowRate,
          ),
        );
      }
    }
  });

  // Create target sink nodes
  plan.nodes.forEach((node, nodeId) => {
    if (node.type === "item" && node.isTarget && !node.isRawMaterial) {
      const targetNodeId = createTargetSinkId(node.itemId);

      // Find the recipe producing this target
      const producerRecipeId = Array.from(plan.edges).find(
        (e) => e.to === nodeId && plan.nodes.get(e.from)?.type === "recipe",
      )?.from;

      const producerRecipe = producerRecipeId
        ? (plan.nodes.get(producerRecipeId) as
          | Extract<ProductionGraphNode, { type: "recipe" }>
          | undefined)
        : undefined;

      targetSinkNodes.push(
        createTargetSinkNode(
          targetNodeId,
          node.item,
          node.productionRate,
          items,
          facilities,
          producerRecipe
            ? {
              facility: producerRecipe.facility,
              facilityCount: producerRecipe.facilityCount,
              recipe: producerRecipe.recipe,
            }
            : undefined,
        ),
      );

      // Edge from producer recipe to target sink
      if (producerRecipeId) {
        flowEdges.push(
          createEdge(
            `e${edgeIdCounter++}`,
            producerRecipeId,
            targetNodeId,
            node.productionRate,
          ),
        );
      }
    }
  });

  return {
    nodes: [...flowNodes, ...targetSinkNodes] as (
      | FlowProductionNode
      | FlowTargetNode
    )[],
    edges: flowEdges,
  };
}
