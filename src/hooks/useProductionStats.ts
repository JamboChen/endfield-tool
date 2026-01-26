import { useMemo } from "react";
import type { ProductionDependencyGraph, ItemId, FacilityId } from "@/types";

export type ProductionStats = {
  totalPowerConsumption: number;
  rawMaterialRequirements: Map<ItemId, number>;
  uniqueProductionSteps: number;
  facilityRequirements: Map<FacilityId, number>;
};

/**
 * Collects statistics from the production graph.
 */
function collectStats(
  plan: ProductionDependencyGraph,
  manualRawMaterials: Set<ItemId>,
): ProductionStats {
  let totalPower = 0;
  const rawMaterials = new Map<ItemId, number>();
  const facilityRequirements = new Map<FacilityId, number>();
  let uniqueProductionSteps = 0;

  plan.nodes.forEach((node) => {
    if (node.type === "item") {
      // Count raw materials
      if (node.isRawMaterial || manualRawMaterials.has(node.itemId)) {
        rawMaterials.set(
          node.itemId,
          (rawMaterials.get(node.itemId) || 0) + node.productionRate,
        );
      } else if (node.productionRate > 0) {
        // Count unique production steps (items being produced)
        uniqueProductionSteps++;
      }
    } else if (node.type === "recipe") {
      // Accumulate power consumption
      totalPower += node.facility.powerConsumption * node.facilityCount;

      // Accumulate facility requirements
      if (node.facilityCount >= 0.01) {
        facilityRequirements.set(
          node.facility.id,
          (facilityRequirements.get(node.facility.id) || 0) +
            node.facilityCount,
        );
      }
    }
  });

  return {
    totalPowerConsumption: totalPower,
    rawMaterialRequirements: rawMaterials,
    uniqueProductionSteps,
    facilityRequirements,
  };
}

/**
 * Hook to calculate production statistics from the plan.
 */
export function useProductionStats(
  plan: ProductionDependencyGraph | null,
  manualRawMaterials: Set<ItemId>,
): ProductionStats {
  return useMemo(() => {
    if (!plan || plan.nodes.size === 0) {
      return {
        totalPowerConsumption: 0,
        rawMaterialRequirements: new Map(),
        uniqueProductionSteps: 0,
        facilityRequirements: new Map(),
      };
    }

    return collectStats(plan, manualRawMaterials);
  }, [plan, manualRawMaterials]);
}
