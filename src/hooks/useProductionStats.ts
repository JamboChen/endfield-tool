import { useMemo } from "react";
import type { UnifiedProductionPlan, ItemId, ProductionNode } from "@/types";

export type ProductionStats = {
  totalPowerConsumption: number;
  rawMaterialRequirements: Map<ItemId, number>;
  productionSteps: number;
};

/**
 * Traverses the production tree and collects statistics.
 */
function collectStats(
  rootNodes: ProductionNode[],
  manualRawMaterials: Set<ItemId>,
): ProductionStats {
  let totalPower = 0;
  const rawMaterials = new Map<ItemId, number>();
  const processedNodes = new Set<string>();

  // Helper to create a unique key for deduplication
  const createNodeKey = (node: ProductionNode): string => {
    return `${node.item.id}-${node.recipe?.id || "raw"}-${node.isRawMaterial}`;
  };

  const traverse = (node: ProductionNode) => {
    // Skip cycle placeholders
    if (node.isCyclePlaceholder) {
      node.dependencies.forEach(traverse);
      return;
    }

    const key = createNodeKey(node);

    // Track unique production steps (for counting)
    if (!node.isRawMaterial && !manualRawMaterials.has(node.item.id)) {
      processedNodes.add(key);
    }

    // Accumulate raw materials
    if (node.isRawMaterial || manualRawMaterials.has(node.item.id)) {
      rawMaterials.set(
        node.item.id,
        (rawMaterials.get(node.item.id) || 0) + node.targetRate,
      );
    } else if (node.facility) {
      // Accumulate power consumption
      totalPower += node.facility.powerConsumption * node.facilityCount;
    }

    // Recursively traverse dependencies
    node.dependencies.forEach(traverse);
  };

  rootNodes.forEach(traverse);

  return {
    totalPowerConsumption: totalPower,
    rawMaterialRequirements: rawMaterials,
    productionSteps: processedNodes.size,
  };
}

/**
 * Hook to calculate production statistics from the plan.
 * Handles all statistical aggregations needed for the summary panel.
 */
export function useProductionStats(
  plan: UnifiedProductionPlan | null,
  manualRawMaterials: Set<ItemId>,
): ProductionStats {
  return useMemo(() => {
    if (!plan || plan.dependencyRootNodes.length === 0) {
      return {
        totalPowerConsumption: 0,
        rawMaterialRequirements: new Map(),
        productionSteps: 0,
      };
    }

    return collectStats(plan.dependencyRootNodes, manualRawMaterials);
  }, [plan, manualRawMaterials]);
}
