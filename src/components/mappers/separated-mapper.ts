import type { Edge } from "@xyflow/react";
import type {
  Item,
  Facility,
  ItemId,
  ProductionDependencyGraph,
  ProductionGraphNode,
  FlowProductionNode,
  FlowTargetNode,
} from "@/types";
import { CapacityPoolManager } from "../flow/capacity-pool";
import {
  createEdge,
  createProductionFlowNode,
  createTargetSinkNode,
} from "../flow/flow-utils";
import { createTargetSinkId } from "@/lib/node-keys";

/**
 * Maps ProductionDependencyGraph to React Flow nodes and edges in separated mode.
 * Each physical facility is represented as an individual node.
 */
export function mapPlanToFlowSeparated(
  plan: ProductionDependencyGraph,
  items: Item[],
  facilities: Facility[],
): { nodes: (FlowProductionNode | FlowTargetNode)[]; edges: Edge[] } {
  const poolManager = new CapacityPoolManager();
  const rawMaterialNodes = new Map<ItemId, string>();
  const flowNodes: FlowProductionNode[] = [];
  const targetSinkNodes: FlowTargetNode[] = [];
  const edges: Edge[] = [];
  let edgeIdCounter = 0;

  // Create pools for all recipe nodes
  plan.nodes.forEach((node, nodeId) => {
    if (node.type === "recipe") {
      const outputItemId = plan.edges.find((e) => e.from === nodeId)?.to;
      const outputItemNode = outputItemId
        ? (plan.nodes.get(outputItemId) as
            | Extract<ProductionGraphNode, { type: "item" }>
            | undefined)
        : undefined;

      if (outputItemNode) {
        poolManager.createPool(
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
          nodeId,
        );
      }
    }
  });

  function ensureRawMaterialNode(
    itemId: ItemId,
    item: Item,
    totalDemand: number,
  ): string {
    let rawNodeId = rawMaterialNodes.get(itemId);

    if (!rawNodeId) {
      rawNodeId = `raw_${itemId}`;
      rawMaterialNodes.set(itemId, rawNodeId);

      flowNodes.push(
        createProductionFlowNode(
          rawNodeId,
          {
            item,
            targetRate: totalDemand,
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

    return rawNodeId;
  }

  function allocateUpstream(
    itemId: ItemId,
    demandRate: number,
    consumerFacilityId: string,
  ): void {
    const itemNode = plan.nodes.get(itemId) as
      | Extract<ProductionGraphNode, { type: "item" }>
      | undefined;
    if (!itemNode) return;

    // Find producer recipe
    const producerRecipeId = Array.from(plan.edges).find(
      (e) => e.to === itemId && plan.nodes.get(e.from)?.type === "recipe",
    )?.from;

    if (!producerRecipeId) {
      // Raw material
      const rawNodeId = ensureRawMaterialNode(
        itemId,
        itemNode.item,
        itemNode.productionRate,
      );

      edges.push(
        createEdge(
          `e${edgeIdCounter++}`,
          rawNodeId,
          consumerFacilityId,
          demandRate,
        ),
      );
      return;
    }

    // Check for circular dependency (backward edge)
    const isBackward = consumerFacilityId.startsWith(producerRecipeId);

    allocateFromPool(
      producerRecipeId,
      demandRate,
      consumerFacilityId,
      isBackward ? "backward" : undefined,
    );
  }

  function allocateFromPool(
    recipeId: string,
    demandRate: number,
    consumerFacilityId: string,
    edgeDirection?: "backward",
  ): void {
    if (!poolManager.hasPool(recipeId)) {
      console.warn(`Pool not found for ${recipeId}`);
      return;
    }

    const allocations = poolManager.allocate(recipeId, demandRate);
    const recipeNode = plan.nodes.get(recipeId) as Extract<
      ProductionGraphNode,
      { type: "recipe" }
    >;
    const outputItemId = plan.edges.find((e) => e.from === recipeId)?.to;
    const outputItemNode = outputItemId
      ? (plan.nodes.get(outputItemId) as
          | Extract<ProductionGraphNode, { type: "item" }>
          | undefined)
      : undefined;

    if (!recipeNode || !outputItemNode) return;

    allocations.forEach((allocation) => {
      edges.push(
        createEdge(
          `e${edgeIdCounter++}`,
          allocation.sourceNodeId,
          consumerFacilityId,
          allocation.allocatedAmount,
          edgeDirection,
        ),
      );

      if (!poolManager.isProcessed(allocation.sourceNodeId)) {
        poolManager.markProcessed(allocation.sourceNodeId);

        const facilityInstance = poolManager
          .getFacilityInstances(recipeId)
          .find((f) => f.facilityId === allocation.sourceNodeId);

        if (facilityInstance) {
          const totalFacilities =
            poolManager.getFacilityInstances(recipeId).length;
          const isPartialLoad =
            facilityInstance.actualOutputRate <
            facilityInstance.maxOutputRate * 0.999;

          // Create facility node
          flowNodes.push(
            createProductionFlowNode(
              allocation.sourceNodeId,
              {
                item: outputItemNode.item,
                targetRate: facilityInstance.actualOutputRate,
                recipe: recipeNode.recipe,
                facility: recipeNode.facility,
                facilityCount: 1,
                isRawMaterial: false,
                isTarget: outputItemNode.isTarget,
                dependencies: [],
              },
              items,
              facilities,
              {
                facilityIndex: facilityInstance.facilityIndex,
                totalFacilities: totalFacilities,
                isPartialLoad: isPartialLoad,
                isDirectTarget: false,
              },
            ),
          );

          recipeNode.recipe.inputs.forEach((input) => {
            const inputDemandRate =
              ((input.amount * 60) / recipeNode.recipe.craftingTime) *
              (facilityInstance.actualOutputRate /
                ((recipeNode.recipe.outputs[0].amount * 60) /
                  recipeNode.recipe.craftingTime));

            allocateUpstream(
              input.itemId,
              inputDemandRate,
              allocation.sourceNodeId,
            );
          });
        }
      }
    });
  }

  plan.nodes.forEach((node, nodeId) => {
    if (node.type !== "recipe") return;

    const outputItemId = plan.edges.find((e) => e.from === nodeId)?.to;
    const outputItemNode = outputItemId
      ? (plan.nodes.get(outputItemId) as
          | Extract<ProductionGraphNode, { type: "item" }>
          | undefined)
      : undefined;

    if (!outputItemNode || outputItemNode.isTarget) return;

    const facilityInstances = poolManager.getFacilityInstances(nodeId);

    facilityInstances.forEach((facilityInstance) => {
      if (poolManager.isProcessed(facilityInstance.facilityId)) return;

      poolManager.markProcessed(facilityInstance.facilityId);

      const isPartialLoad =
        facilityInstance.actualOutputRate <
        facilityInstance.maxOutputRate * 0.999;

      flowNodes.push(
        createProductionFlowNode(
          facilityInstance.facilityId,
          {
            item: outputItemNode.item,
            targetRate: facilityInstance.actualOutputRate,
            recipe: node.recipe,
            facility: node.facility,
            facilityCount: 1,
            isRawMaterial: false,
            isTarget: false,
            dependencies: [],
          },
          items,
          facilities,
          {
            facilityIndex: facilityInstance.facilityIndex,
            totalFacilities: facilityInstances.length,
            isPartialLoad: isPartialLoad,
            isDirectTarget: false,
          },
        ),
      );

      // Allocate upstream for this facility's dependencies
      node.recipe.inputs.forEach((input) => {
        const inputDemandRate =
          ((input.amount * 60) / node.recipe.craftingTime) *
          (facilityInstance.actualOutputRate /
            ((node.recipe.outputs[0].amount * 60) / node.recipe.craftingTime));

        allocateUpstream(
          input.itemId,
          inputDemandRate,
          facilityInstance.facilityId,
        );
      });
    });
  });

  // Create target sink nodes
  plan.nodes.forEach((node, nodeId) => {
    if (node.type !== "item" || !node.isTarget) return;

    const targetSinkId = createTargetSinkId(node.itemId);

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
        targetSinkId,
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

    // Connect dependencies to target sink
    if (producerRecipe) {
      producerRecipe.recipe.inputs.forEach((input) => {
        const inputDemandRate =
          (input.amount / producerRecipe.recipe.outputs[0].amount) *
          node.productionRate;

        allocateUpstream(input.itemId, inputDemandRate, targetSinkId);
      });
    }
  });

  return {
    nodes: [...flowNodes, ...targetSinkNodes],
    edges: edges,
  };
}
