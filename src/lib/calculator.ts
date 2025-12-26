import type {
  Item,
  Recipe,
  Facility,
  ItemId,
  RecipeId,
  FacilityId,
} from "@/types";

/**
 * Represents a single step in the production chain.
 * This is the building block for the dependency tree.
 */
export type ProductionNode = {
  item: Item;
  targetRate: number;
  recipe: Recipe | null;
  facility: Facility | null;
  facilityCount: number;
  isRawMaterial: boolean;
  isTarget: boolean;
  dependencies: ProductionNode[];
  manualRawMaterials?: Set<ItemId>;
};

/**
 * Represents a detected production cycle in the dependency graph.
 * Cycles are self-sufficient production loops that can produce output without external input.
 */
export type DetectedCycle = {
  /** Unique identifier for this cycle */
  cycleId: string;
  /** Item IDs involved in the cycle, in dependency order */
  involvedItemIds: ItemId[];
  /** The item ID where the cycle was broken to create a tree structure */
  breakPointItemId: ItemId;
  /** The complete production nodes within the cycle (before breaking) */
  cycleNodes: ProductionNode[];
  /** Net output items per minute (items that can be extracted from the cycle) */
  netOutputs: Map<ItemId, number>;
};

/**
 * The unified output structure for the production plan.
 * It contains both the raw dependency trees and the merged/flattened list for statistics.
 */
export type UnifiedProductionPlan = {
  /** The unmerged root nodes, suitable for dependency tree visualization. */
  dependencyRootNodes: ProductionNode[];
  /** The merged and sorted list of production steps, suitable for tables and statistics. */
  flatList: ProductionNode[];
  /** Total electrical power consumption for all facilities. */
  totalPowerConsumption: number;
  /** Map of ItemId to the required rate of raw materials (items with no recipes). */
  rawMaterialRequirements: Map<ItemId, number>;
  manualRawMaterials?: Set<ItemId>;
  /** Detected production cycles (for tree view visualization) */
  detectedCycles: DetectedCycle[];
};

export type RecipeSelector = (
  availableRecipes: Recipe[],
  visitedPath?: Set<ItemId>,
) => Recipe;

const defaultRecipeSelector: RecipeSelector = (recipes) => recipes[0];

export const smartRecipeSelector: RecipeSelector = (recipes, visitedPath) => {
  if (!visitedPath || visitedPath.size === 0) {
    return defaultRecipeSelector(recipes);
  }

  // Find recipes that don't create circular dependencies
  const nonCircularRecipes = recipes.filter((recipe) => {
    // Check if any input would create a circular dependency
    const hasCircularInput = recipe.inputs.some((input) =>
      visitedPath.has(input.itemId),
    );

    return !hasCircularInput;
  });

  return nonCircularRecipes.length > 0
    ? nonCircularRecipes[0]
    : defaultRecipeSelector(recipes);
};

type ProductionMaps = {
  itemMap: Map<ItemId, Item>;
  recipeMap: Map<RecipeId, Recipe>;
  facilityMap: Map<FacilityId, Facility>;
};

/** Represents a production node after merging duplicates and tracking dependencies. */
type MergedNode = {
  item: Item;
  totalRate: number;
  recipe: Recipe | null;
  facility: Facility | null;
  totalFacilityCount: number;
  isRawMaterial: boolean;
  isTarget: boolean;
  dependencies: Set<string>;
};

/** Generates a unique key for a production node based on its item, recipe, and raw material status. */
function createNodeKey(
  itemId: ItemId,
  recipeId: RecipeId | null,
  isRawMaterial: boolean,
): string {
  return isRawMaterial ? `raw_${itemId}` : `${itemId}_${recipeId}`;
}

/** Recursively collects all item IDs that are *produced* (i.e., not raw materials) within the given production nodes. */
function collectProducedItems(nodes: ProductionNode[]): Set<ItemId> {
  const producedItemIds = new Set<ItemId>();

  const collect = (node: ProductionNode) => {
    if (!node.isRawMaterial && node.recipe) {
      producedItemIds.add(node.item.id);
    }
    node.dependencies.forEach(collect);
  };

  nodes.forEach(collect);
  return producedItemIds;
}

/** Determines if a node represents a circular dependency that is being treated as a raw material to break the cycle. */
function isCircularDependency(
  node: ProductionNode,
  producedItemIds: Set<ItemId>,
): boolean {
  // A node is a circular dependency if it's marked as a raw material,
  // but it is an item that is actually produced somewhere else in the graph.
  return node.isRawMaterial && producedItemIds.has(node.item.id);
}

/** Merges duplicate production nodes and aggregates their rates and facility counts. It also collects and consolidates dependencies. */
function mergeProductionNodes(
  rootNodes: ProductionNode[],
  producedItemIds: Set<ItemId>,
): Map<string, MergedNode> {
  const mergedNodes = new Map<string, MergedNode>();

  const collectNodes = (node: ProductionNode) => {
    if (isCircularDependency(node, producedItemIds)) {
      return;
    }

    const key = createNodeKey(
      node.item.id,
      node.recipe?.id || null,
      node.isRawMaterial,
    );

    const existing = mergedNodes.get(key);
    if (existing) {
      existing.totalRate += node.targetRate;
      existing.totalFacilityCount += node.facilityCount;

      if (node.isTarget && !existing.isTarget) {
        existing.isTarget = true;
      }

      node.dependencies.forEach((dep) => {
        if (!isCircularDependency(dep, producedItemIds)) {
          const depKey = createNodeKey(
            dep.item.id,
            dep.recipe?.id || null,
            dep.isRawMaterial,
          );
          existing.dependencies.add(depKey);
        }
      });
    } else {
      const dependencies = new Set<string>();
      node.dependencies.forEach((dep) => {
        if (!isCircularDependency(dep, producedItemIds)) {
          const depKey = createNodeKey(
            dep.item.id,
            dep.recipe?.id || null,
            dep.isRawMaterial,
          );
          dependencies.add(depKey);
        }
      });

      mergedNodes.set(key, {
        item: node.item,
        totalRate: node.targetRate,
        recipe: node.recipe,
        facility: node.facility,
        totalFacilityCount: node.facilityCount,
        isRawMaterial: node.isRawMaterial,
        isTarget: node.isTarget,
        dependencies,
      });
    }

    node.dependencies.forEach(collectNodes);
  };

  rootNodes.forEach(collectNodes);
  return mergedNodes;
}

/**
 * Performs a topological sort on merged production nodes.
 * The sort order is from producers (raw materials) to consumers (final products).
 */
function topologicalSort(mergedNodes: Map<string, MergedNode>): string[] {
  const sortedKeys: string[] = [];
  const dependentCount = new Map<string, number>();
  const keyToNode = new Map(mergedNodes);

  // Initialize dependent counts (how many nodes depend on this node)
  keyToNode.forEach((_, key) => dependentCount.set(key, 0));

  // Calculate dependent counts for each node
  keyToNode.forEach((node) => {
    node.dependencies.forEach((depKey) => {
      // Increment the dependent count of the dependency (producer)
      if (keyToNode.has(depKey)) {
        dependentCount.set(depKey, (dependentCount.get(depKey) || 0) + 1);
      }
    });
  });

  // Initialize the queue with nodes that have no dependents (final products)
  const queue: string[] = [];
  keyToNode.forEach((_, key) => {
    if (dependentCount.get(key) === 0) {
      queue.push(key);
    }
  });

  // Process nodes from final products to raw materials
  while (queue.length > 0) {
    const key = queue.shift()!;
    sortedKeys.push(key);

    const node = keyToNode.get(key)!;

    // Decrement the dependent count of dependencies
    node.dependencies.forEach((depKey) => {
      if (keyToNode.has(depKey)) {
        const currentCount = dependentCount.get(depKey)! - 1;
        dependentCount.set(depKey, currentCount);

        // If a dependency now has no remaining dependents, add it to the queue
        if (currentCount === 0) {
          queue.push(depKey);
        }
      }
    });
  }

  // Reverse to get producer-to-consumer order
  return sortedKeys.reverse();
}

/** Calculates the depth level for each node in the dependency graph, where raw materials are at level 0. */
function calculateNodeLevels(
  sortedKeys: string[],
  mergedNodes: Map<string, MergedNode>,
): Map<string, number> {
  const keyToLevel = new Map<string, number>();

  const calculateLevel = (key: string): number => {
    if (keyToLevel.has(key)) {
      return keyToLevel.get(key)!;
    }

    const node = mergedNodes.get(key);
    // Base case: raw material or node with no dependencies is level 0
    if (!node || node.dependencies.size === 0) {
      keyToLevel.set(key, 0);
      return 0;
    }

    let maxDepLevel = -1;
    node.dependencies.forEach((depKey) => {
      if (mergedNodes.has(depKey)) {
        maxDepLevel = Math.max(maxDepLevel, calculateLevel(depKey));
      }
    });

    const level = maxDepLevel + 1;
    keyToLevel.set(key, level);
    return level;
  };

  // Calculate levels in the topologically sorted order
  sortedKeys.forEach((key) => calculateLevel(key));
  return keyToLevel;
}

/** Sorts node keys by their calculated level (deepest first) and then by item tier (highest first within each level). */
function sortByLevelAndTier(
  sortedKeys: string[],
  mergedNodes: Map<string, MergedNode>,
): string[] {
  const keyToLevel = calculateNodeLevels(sortedKeys, mergedNodes);

  const levels = new Map<number, string[]>();
  sortedKeys.forEach((key) => {
    const level = keyToLevel.get(key)!;
    if (!levels.has(level)) {
      levels.set(level, []);
    }
    levels.get(level)!.push(key);
  });

  // Sort levels from deepest (highest number) to shallowest (0)
  const sortedLevels = Array.from(levels.keys()).sort((a, b) => b - a);

  const result: string[] = [];
  sortedLevels.forEach((level) => {
    const keysInLevel = levels.get(level)!;
    // Sort items within the same level by their tier (higher tier first)
    keysInLevel.sort((a, b) => {
      const nodeA = mergedNodes.get(a)!;
      const nodeB = mergedNodes.get(b)!;
      return nodeB.item.tier - nodeA.item.tier;
    });
    result.push(...keysInLevel);
  });

  return result;
}

/**
 * Constructs the final flattened plan components (list, power, raw materials)
 * from the merged and sorted production nodes.
 */
function buildFinalPlanComponents(
  sortedKeys: string[],
  mergedNodes: Map<string, MergedNode>,
): {
  flatList: ProductionNode[];
  totalPowerConsumption: number;
  rawMaterialRequirements: Map<ItemId, number>;
  detectedCycles: DetectedCycle[];
} {
  const rawMaterialRequirements = new Map<ItemId, number>();
  let totalPowerConsumption = 0;
  const flatList: ProductionNode[] = [];

  sortedKeys.forEach((key) => {
    const node = mergedNodes.get(key)!;

    if (node.isRawMaterial) {
      rawMaterialRequirements.set(
        node.item.id,
        (rawMaterialRequirements.get(node.item.id) || 0) + node.totalRate,
      );
    } else if (node.facility) {
      totalPowerConsumption +=
        node.facility.powerConsumption * node.totalFacilityCount;
    }

    flatList.push({
      item: node.item,
      targetRate: node.totalRate,
      recipe: node.recipe,
      facility: node.facility,
      facilityCount: node.totalFacilityCount,
      isRawMaterial: node.isRawMaterial,
      isTarget: node.isTarget,
      dependencies: [],
    });
  });

  return {
    flatList,
    totalPowerConsumption,
    rawMaterialRequirements,
    detectedCycles: [],
  };
}

/**
 * Reconstructs a production cycle by recalculating nodes without breaking the loop.
 * This is used to capture the complete cycle structure for visualization purposes.
 */
function reconstructCycle(
  cyclePath: ItemId[],
  maps: ProductionMaps,
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  manualRawMaterials?: Set<ItemId>,
): ProductionNode[] {
  const cycleNodes: ProductionNode[] = [];
  const pathSet = new Set(cyclePath);

  // Calculate each node in the cycle, treating cycle members as valid dependencies
  for (let i = 0; i < cyclePath.length; i++) {
    const itemId = cyclePath[i];
    const nextItemId = cyclePath[(i + 1) % cyclePath.length];

    const item = maps.itemMap.get(itemId);
    if (!item) continue;

    // Skip manually marked raw materials
    if (manualRawMaterials?.has(itemId)) continue;

    const availableRecipes = Array.from(maps.recipeMap.values()).filter((r) =>
      r.outputs.some((o) => o.itemId === itemId),
    );

    if (availableRecipes.length === 0) continue;

    // Select recipe
    let selectedRecipe: Recipe;
    if (recipeOverrides?.has(itemId)) {
      const overrideRecipe = maps.recipeMap.get(recipeOverrides.get(itemId)!);
      if (!overrideRecipe) continue;
      selectedRecipe = overrideRecipe;
    } else {
      // Filter recipes that consume the next item in the cycle (to maintain cycle continuity)
      const cycleCompatibleRecipes = availableRecipes.filter((recipe) =>
        recipe.inputs.some((input) => input.itemId === nextItemId),
      );

      // Use the provided recipe selector on filtered recipes
      const recipesToSelect =
        cycleCompatibleRecipes.length > 0
          ? cycleCompatibleRecipes
          : availableRecipes;

      // Create a visited path for the selector (all items in cycle up to current)
      const selectorVisitedPath = new Set(cyclePath.slice(0, i + 1));
      selectedRecipe = recipeSelector(recipesToSelect, selectorVisitedPath);
    }

    const facility = maps.facilityMap.get(selectedRecipe.facilityId);
    if (!facility) continue;

    // For cycle reconstruction, use a nominal rate (1 item/min)
    const nominalRate = 1;
    const outputAmount =
      selectedRecipe.outputs.find((o) => o.itemId === itemId)?.amount || 0;
    const cyclesPerMinute = 60 / selectedRecipe.craftingTime;
    const outputRatePerFacility = outputAmount * cyclesPerMinute;
    const facilityCount = nominalRate / outputRatePerFacility;

    // Create simplified dependencies (just references to items, not full recursion)
    const dependencies = selectedRecipe.inputs.map((input) => {
      const depItem = maps.itemMap.get(input.itemId);
      if (!depItem)
        throw new Error(`Dependency item not found: ${input.itemId}`);

      return {
        item: depItem,
        targetRate: input.amount * cyclesPerMinute * facilityCount,
        recipe: null,
        facility: null,
        facilityCount: 0,
        isRawMaterial: !pathSet.has(input.itemId), // Items outside cycle are raw materials
        isTarget: false,
        dependencies: [],
      } as ProductionNode;
    });

    cycleNodes.push({
      item,
      targetRate: nominalRate,
      recipe: selectedRecipe,
      facility,
      facilityCount,
      isRawMaterial: false,
      isTarget: false,
      dependencies,
    });
  }

  return cycleNodes;
}

/**
 * Calculates net outputs of a production cycle.
 * Net output is what can be extracted from the cycle while maintaining it.
 */
function calculateCycleNetOutputs(
  cycleNodes: ProductionNode[],
): Map<ItemId, number> {
  const production = new Map<ItemId, number>();
  const consumption = new Map<ItemId, number>();

  // Calculate per-cycle production and consumption
  cycleNodes.forEach((node) => {
    if (!node.recipe) {
      return;
    }

    node.recipe.outputs.forEach((output) => {
      production.set(
        output.itemId,
        (production.get(output.itemId) || 0) + output.amount,
      );
    });

    node.recipe.inputs.forEach((input) => {
      consumption.set(
        input.itemId,
        (consumption.get(input.itemId) || 0) + input.amount,
      );
    });
  });

  // Calculate net per cycle
  const netOutputs = new Map<ItemId, number>();
  production.forEach((produced, itemId) => {
    const consumed = consumption.get(itemId) || 0;
    const net = produced - consumed;

    if (Math.abs(net) > 0.001) {
      netOutputs.set(itemId, net);
    }
  });

  return netOutputs;
}

/**
 * Generates a unique cycle ID based on the involved items.
 */
function generateCycleId(involvedItemIds: ItemId[]): string {
  // Sort to ensure consistent ID regardless of detection order
  const sorted = [...involvedItemIds].sort();
  return `cycle-${sorted.join("-")}`;
}

/**
 * Checks if a cycle has already been detected based on involved items.
 */
function isCycleDuplicate(
  cycle: DetectedCycle,
  existingCycles: DetectedCycle[],
): boolean {
  const cycleItemsSet = new Set(cycle.involvedItemIds);

  return existingCycles.some((existing) => {
    if (existing.involvedItemIds.length !== cycle.involvedItemIds.length) {
      return false;
    }
    return existing.involvedItemIds.every((itemId) =>
      cycleItemsSet.has(itemId),
    );
  });
}

/**
 * Generates the raw, unmerged dependency trees for all targets.
 * Also detects and collects information about production cycles.
 */
function buildDependencyTree(
  targets: Array<{ itemId: ItemId; rate: number }>,
  maps: ProductionMaps,
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  manualRawMaterials?: Set<ItemId>,
): { rootNodes: ProductionNode[]; detectedCycles: DetectedCycle[] } {
  const detectedCycles: DetectedCycle[] = [];

  // Modified version of calculateNode that collects cycle info
  const calculateNodeWithCycleDetection = (
    itemId: ItemId,
    requiredRate: number,
    visitedPath: Set<ItemId>,
    isDirectTarget: boolean,
  ): ProductionNode => {
    const item = maps.itemMap.get(itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);

    // Check for circular dependency BEFORE creating the break
    if (visitedPath.has(itemId)) {
      // Reconstruct the cycle path
      const pathArray = Array.from(visitedPath);
      const cycleStartIndex = pathArray.indexOf(itemId);
      const cyclePath = pathArray.slice(cycleStartIndex);

      // Generate cycle information
      const cycleId = generateCycleId(cyclePath);
      const cycleNodes = reconstructCycle(
        cyclePath,
        maps,
        recipeOverrides,
        recipeSelector,
        manualRawMaterials,
      );
      const netOutputs = calculateCycleNetOutputs(cycleNodes);

      const cycle: DetectedCycle = {
        cycleId,
        involvedItemIds: cyclePath,
        breakPointItemId: itemId,
        cycleNodes,
        netOutputs,
      };

      // Only add if not duplicate
      if (!isCycleDuplicate(cycle, detectedCycles)) {
        detectedCycles.push(cycle);
      }

      // Return the break node (same as original calculateNode logic)
      return {
        item,
        targetRate: requiredRate,
        recipe: null,
        facility: null,
        facilityCount: 0,
        isRawMaterial: true,
        isTarget: false,
        dependencies: [],
      };
    }

    // Check if manually marked as raw material
    if (manualRawMaterials?.has(itemId)) {
      return {
        item,
        targetRate: requiredRate,
        recipe: null,
        facility: null,
        facilityCount: 0,
        isRawMaterial: true,
        isTarget: isDirectTarget,
        dependencies: [],
      };
    }

    const availableRecipes = Array.from(maps.recipeMap.values()).filter((r) =>
      r.outputs.some((o) => o.itemId === itemId),
    );

    if (availableRecipes.length === 0) {
      return {
        item,
        targetRate: requiredRate,
        recipe: null,
        facility: null,
        facilityCount: 0,
        isRawMaterial: true,
        isTarget: isDirectTarget,
        dependencies: [],
      };
    }

    // Add current item to visited path BEFORE recipe selection
    const newVisitedPath = new Set(visitedPath);
    newVisitedPath.add(itemId);

    // Recipe selection logic
    let selectedRecipe: Recipe;
    if (recipeOverrides?.has(itemId)) {
      const overrideRecipe = maps.recipeMap.get(recipeOverrides.get(itemId)!);
      if (!overrideRecipe)
        throw new Error(`Override recipe not found for ${itemId}`);
      selectedRecipe = overrideRecipe;
    } else {
      selectedRecipe = recipeSelector(availableRecipes, newVisitedPath);
    }

    const facility = maps.facilityMap.get(selectedRecipe.facilityId);
    if (!facility)
      throw new Error(`Facility not found: ${selectedRecipe.facilityId}`);

    // Production rate calculation
    const outputAmount =
      selectedRecipe.outputs.find((o) => o.itemId === itemId)?.amount || 0;
    const cyclesPerMinute = 60 / selectedRecipe.craftingTime;
    const outputRatePerFacility = outputAmount * cyclesPerMinute;

    // Calculate required facilities
    const facilityCount = requiredRate / outputRatePerFacility;

    // Recursively calculate dependencies using the wrapper function
    const dependencies = selectedRecipe.inputs.map((input) => {
      const inputRate = input.amount * cyclesPerMinute * facilityCount;
      return calculateNodeWithCycleDetection(
        input.itemId,
        inputRate,
        newVisitedPath,
        false,
      );
    });

    return {
      item,
      targetRate: requiredRate,
      recipe: selectedRecipe,
      facility,
      facilityCount,
      isRawMaterial: false,
      isTarget: isDirectTarget,
      dependencies,
    };
  };

  const rootNodes = targets.map((t) =>
    calculateNodeWithCycleDetection(t.itemId, t.rate, new Set(), true),
  );

  return { rootNodes, detectedCycles };
}

/**
 * Processes the raw dependency trees to create a merged, sorted, and flattened production plan.
 */
function processMergedPlan(
  rootNodes: ProductionNode[],
): Omit<UnifiedProductionPlan, "dependencyRootNodes"> {
  // 1. Identify all items that are produced by any recipe within the entire production graph.
  const producedItemIds = collectProducedItems(rootNodes);

  // 2. Merge duplicate production steps and aggregate requirements.
  const mergedNodes = mergeProductionNodes(rootNodes, producedItemIds);

  // 3. Sort the merged nodes for a logical flow (producer -> consumer) and better display.
  const sortedKeys = topologicalSort(mergedNodes);
  const sortedByLevelAndTier = sortByLevelAndTier(sortedKeys, mergedNodes);

  // 4. Build the final flat list and calculate statistics.
  return buildFinalPlanComponents(sortedByLevelAndTier, mergedNodes);
}

/**
 * Calculates a complete production plan for multiple target items at specified rates.
 * The output includes the raw dependency trees (for visualization) and the merged flat list (for statistics).
 */
export function calculateProductionPlan(
  targets: Array<{ itemId: ItemId; rate: number }>,
  items: Item[],
  recipes: Recipe[],
  facilities: Facility[],
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  manualRawMaterials?: Set<ItemId>,
): UnifiedProductionPlan {
  if (targets.length === 0) throw new Error("No targets specified");

  // Create lookup maps for efficient access to items, recipes, and facilities.
  const maps: ProductionMaps = {
    itemMap: new Map(items.map((i) => [i.id, i])),
    recipeMap: new Map(recipes.map((r) => [r.id, r])),
    facilityMap: new Map(facilities.map((f) => [f.id, f])),
  };

  // 1. Build the raw, unmerged dependency tree(s) and collect cycle information.
  const { rootNodes: dependencyRootNodes, detectedCycles } =
    buildDependencyTree(
      targets,
      maps,
      recipeOverrides,
      recipeSelector,
      manualRawMaterials,
    );

  // 2. Process the merged and flattened plan for statistics and tables.
  const { flatList, totalPowerConsumption, rawMaterialRequirements } =
    processMergedPlan(dependencyRootNodes);

  // 3. Return the unified plan with cycle information.
  return {
    dependencyRootNodes,
    flatList,
    totalPowerConsumption,
    rawMaterialRequirements,
    detectedCycles,
  };
}
