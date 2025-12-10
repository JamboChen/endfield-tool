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
};

export type RecipeSelector = (
  availableRecipes: Recipe[],
  visitedPath?: Set<ItemId>,
) => Recipe;

const defaultRecipeSelector: RecipeSelector = (recipes) => recipes[0];

export const smartRecipeSelector: RecipeSelector = (recipes, visitedPath) => {
  // If no visited path provided, fall back to first recipe
  if (!visitedPath || visitedPath.size === 0) {
    return defaultRecipeSelector(recipes);
  }

  // Find recipes that don't create circular dependencies
  const nonCircularRecipes = recipes.filter((recipe) => {
    // Check if any input would create a circular dependency with visited path
    const hasCircularInput = recipe.inputs.some((input) =>
      visitedPath.has(input.itemId),
    );

    // Check if any output (other than the main product) would create a circular dependency with visited path
    const hasCircularOutput = recipe.outputs.some((output) =>
      visitedPath.has(output.itemId),
    );

    // Check if recipe has self-loop: same item appears in both inputs and outputs
    const hasSelfLoop = recipe.inputs.some((input) =>
      recipe.outputs.some((output) => output.itemId === input.itemId),
    );

    const hasCircular = hasCircularInput || hasCircularOutput || hasSelfLoop;
    return !hasCircular;
  });

  // Return first non-circular recipe if available, otherwise fall back to first recipe
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
  const inDegree = new Map<string, number>();
  const keyToNode = new Map(mergedNodes);

  // Initialize in-degrees (number of consumers)
  keyToNode.forEach((_, key) => inDegree.set(key, 0));

  // Calculate initial in-degrees
  keyToNode.forEach((node) => {
    node.dependencies.forEach((depKey) => {
      // Increment the in-degree of the dependency (producer)
      if (keyToNode.has(depKey)) {
        inDegree.set(depKey, (inDegree.get(depKey) || 0) + 1);
      }
    });
  });

  // Initialize the queue with nodes that have no consumers (in-degree of 0), these are the final products.
  const queue: string[] = [];
  keyToNode.forEach((_, key) => {
    if (inDegree.get(key) === 0) {
      queue.push(key);
    }
  });

  // Process nodes from consumers to producers (reverse order of final output)
  while (queue.length > 0) {
    const key = queue.shift()!;
    sortedKeys.push(key);

    const node = keyToNode.get(key)!;

    // Decrement the in-degree of dependencies.
    node.dependencies.forEach((depKey) => {
      if (keyToNode.has(depKey)) {
        const currentInDegree = inDegree.get(depKey)! - 1;
        inDegree.set(depKey, currentInDegree);

        // If a dependency now has no remaining consumers, add it to the queue.
        if (currentInDegree === 0) {
          queue.push(depKey);
        }
      }
    });
  }

  // The sort initially goes from consumers to producers. Reverse it to get the desired producer-to-consumer order.
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
): Omit<UnifiedProductionPlan, "dependencyRootNodes"> {
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

  return { flatList, totalPowerConsumption, rawMaterialRequirements };
}

/**
 * Recursively calculates a single production node, determining required facilities and inputs.
 * Handles circular dependencies by treating the looped item as a raw material for that branch.
 */
function calculateNode(
  itemId: ItemId,
  requiredRate: number,
  maps: ProductionMaps,
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  visitedPath: Set<ItemId> = new Set(),
  isDirectTarget: boolean = false,
  manualRawMaterials?: Set<ItemId>,
): ProductionNode {
  const item = maps.itemMap.get(itemId);
  if (!item) throw new Error(`Item not found: ${itemId}`);

  // Check for circular dependency
  if (visitedPath.has(itemId)) {
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

  // Recipe selection logic
  let selectedRecipe: Recipe;
  if (recipeOverrides?.has(itemId)) {
    const overrideRecipe = maps.recipeMap.get(recipeOverrides.get(itemId)!);
    if (!overrideRecipe)
      throw new Error(`Override recipe not found for ${itemId}`);
    selectedRecipe = overrideRecipe;
  } else {
    selectedRecipe = recipeSelector(availableRecipes, visitedPath);
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

  // Add the current item to the visited path for dependency detection
  const newVisitedPath = new Set(visitedPath);
  newVisitedPath.add(itemId);

  // Recursively calculate dependencies (inputs)
  const dependencies = selectedRecipe.inputs.map((input) => {
    // Calculate the required input rate for the total facility count
    const inputRate = input.amount * cyclesPerMinute * facilityCount;
    return calculateNode(
      input.itemId,
      inputRate,
      maps,
      recipeOverrides,
      recipeSelector,
      newVisitedPath,
      false,
      manualRawMaterials,
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
}

/**
 * Generates the raw, unmerged dependency trees for all targets.
 */
function buildDependencyTree(
  targets: Array<{ itemId: ItemId; rate: number }>,
  maps: ProductionMaps,
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  manualRawMaterials?: Set<ItemId>,
): ProductionNode[] {
  return targets.map((t) =>
    calculateNode(
      t.itemId,
      t.rate,
      maps,
      recipeOverrides,
      recipeSelector,
      new Set(),
      true,
      manualRawMaterials,
    ),
  );
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

  // 1. Build the raw, unmerged dependency tree(s).
  const dependencyRootNodes = buildDependencyTree(
    targets,
    maps,
    recipeOverrides,
    recipeSelector,
    manualRawMaterials,
  );

  // 2. Process the merged and flattened plan for statistics and tables.
  const { flatList, totalPowerConsumption, rawMaterialRequirements } =
    processMergedPlan(dependencyRootNodes);

  // 3. Return the unified plan.
  return {
    dependencyRootNodes,
    flatList,
    totalPowerConsumption,
    rawMaterialRequirements,
  };
}
