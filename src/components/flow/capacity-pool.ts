import type {
  CapacityPoolEntry,
  FacilityInstance,
  AllocationResult,
  ProductionNode,
} from "@/types";

/**
 * Manages capacity pools for production facilities in separated visualization mode.
 *
 * Creates individual facility instances from ProductionNodes and handles allocation
 * of their production capacity to downstream consumers using a greedy allocation strategy.
 */
export class CapacityPoolManager {
  private pools: Map<string, CapacityPoolEntry>;
  private processedFacilities: Set<string>;

  constructor() {
    this.pools = new Map();
    this.processedFacilities = new Set();
  }

  /**
   * Checks if a capacity pool exists for the given node key.
   * Used for defensive checks before allocation.
   */
  hasPool(nodeKey: string): boolean {
    return this.pools.has(nodeKey);
  }

  /**
   * Creates a capacity pool for a production node by splitting it into individual facilities.
   * Each facility gets its own capacity. The last facility may operate at partial capacity
   * if the original facilityCount was fractional.
   */
  createPool(node: ProductionNode, nodeKey: string): void {
    if (node.isRawMaterial) return;

    const facilityCount = Math.ceil(node.facilityCount);
    const capacityPerFacility = node.targetRate / node.facilityCount;

    const facilities: FacilityInstance[] = Array.from(
      { length: facilityCount },
      (_, i) => {
        const remainingCapacity = node.targetRate - i * capacityPerFacility;
        const actualOutputRate = Math.max(
          0,
          Math.min(capacityPerFacility, remainingCapacity),
        );

        return {
          facilityId: `${nodeKey}-f${i}`,
          nodeKey,
          facilityIndex: i,
          maxOutputRate: capacityPerFacility,
          actualOutputRate,
          remainingCapacity: actualOutputRate,
        };
      },
    );

    this.pools.set(nodeKey, {
      productionNode: node,
      totalCapacity: node.targetRate,
      facilities,
    });
  }

  /**
   * Allocates production capacity from a producer to satisfy consumer demand.
   * Uses greedy allocation: fills facilities in order until demand is met.
   * May return multiple allocations if demand spans multiple facilities.
   */
  allocate(nodeKey: string, demandRate: number): AllocationResult[] {
    const pool = this.pools.get(nodeKey);
    if (!pool) {
      console.warn(`[CapacityPoolManager] Pool not found for key: ${nodeKey}`);
      return [];
    }

    const results: AllocationResult[] = [];
    let remainingDemand = demandRate;

    for (const facility of pool.facilities) {
      if (remainingDemand <= 0) break;
      if (facility.remainingCapacity <= 0) continue;

      const allocated = Math.min(facility.remainingCapacity, remainingDemand);
      facility.remainingCapacity -= allocated;
      remainingDemand -= allocated;

      results.push({
        sourceNodeId: facility.facilityId,
        allocatedAmount: allocated,
        fromFacilityIndex: facility.facilityIndex,
      });
    }

    if (remainingDemand > 0.001) {
      console.warn(
        `[CapacityPoolManager] Insufficient capacity for ${nodeKey}: ${remainingDemand.toFixed(2)}/min unsatisfied`,
      );
    }

    return results;
  }

  /**
   * Gets all facility instances for a given production node.
   */
  getFacilityInstances(nodeKey: string): FacilityInstance[] {
    return this.pools.get(nodeKey)?.facilities ?? [];
  }

  /**
   * Marks a facility as processed (dependencies have been recursively allocated).
   */
  markProcessed(facilityId: string): void {
    this.processedFacilities.add(facilityId);
  }

  /**
   * Checks if a facility instance has been processed.
   * Returns true if the facility's node and upstream dependencies have been created.
   */
  isProcessed(facilityId: string): boolean {
    return this.processedFacilities.has(facilityId);
  }
}
