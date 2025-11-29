import type {
  Item,
  Recipe,
  Facility,
  ItemId,
  RecipeId,
  FacilityId,
} from "@/types";

export type ProductionNode = {
  item: Item;
  targetRate: number;
  recipe: Recipe | null;
  facility: Facility | null;
  facilityCount: number;
  isRawMaterial: boolean;
  dependencies: ProductionNode[];
};

export type ProductionPlan = {
  rootNode: ProductionNode;
  flatList: ProductionNode[];
  totalPowerConsumption: number;
  rawMaterialRequirements: Map<ItemId, number>;
};

export type RecipeSelector = (
  itemId: ItemId,
  availableRecipes: Recipe[],
) => Recipe;

const defaultRecipeSelector: RecipeSelector = (_itemId, recipes) => recipes[0];

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
  return node.isRawMaterial && producedItemIds.has(node.item.id);
}

/** Merges duplicate production nodes and aggregates their rates and facility counts. It also collects and consolidates dependencies. */
function mergeProductionNodes(
  rootNodes: ProductionNode[],
  producedItemIds: Set<ItemId>,
): Map<string, MergedNode> {
  const mergedNodes = new Map<string, MergedNode>();

  const collectNodes = (node: ProductionNode) => {
    // Skip nodes that are already marked as circular dependency pseudo-raw-materials.
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
        dependencies,
      });
    }

    node.dependencies.forEach(collectNodes);
  };

  rootNodes.forEach(collectNodes);
  return mergedNodes;
}

/**
 * Performs a topological sort on merged production nodes using Kahn's algorithm.
 * The sort order is from producers (raw materials) to consumers (final products).
 * It calculates in-degrees (number of consumers) to determine the processing order.
 */
function topologicalSort(mergedNodes: Map<string, MergedNode>): string[] {
  const sortedKeys: string[] = [];
  const inDegree = new Map<string, number>();
  const keyToNode = new Map(mergedNodes);

  // Initialize in-degrees for all nodes to zero. An "in-degree" here signifies the number of consumers
  // that depend on a given producer node. We want to process final products (consumers with 0 in-degree) first.
  keyToNode.forEach((_, key) => inDegree.set(key, 0));

  keyToNode.forEach((node) => {
    node.dependencies.forEach((depKey) => {
      // Increment the in-degree of the dependency (producer) as the current node (consumer) relies on it.
      if (keyToNode.has(depKey)) {
        inDegree.set(depKey, (inDegree.get(depKey) || 0) + 1);
      }
    });
  });

  // Initialize the queue with nodes that have no consumers (in-degree of 0).
  const queue: string[] = [];
  keyToNode.forEach((_, key) => {
    if (inDegree.get(key) === 0) {
      queue.push(key);
    }
  });

  // Process nodes from consumers to producers.
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

  const sortedLevels = Array.from(levels.keys()).sort((a, b) => b - a);

  const result: string[] = [];
  sortedLevels.forEach((level) => {
    const keysInLevel = levels.get(level)!;
    keysInLevel.sort((a, b) => {
      const nodeA = mergedNodes.get(a)!;
      const nodeB = mergedNodes.get(b)!;
      return nodeB.item.tier - nodeA.item.tier;
    });
    result.push(...keysInLevel);
  });

  return result;
}

/** Constructs the final ProductionPlan object from the merged and sorted production nodes. */
function buildFinalPlan(
  sortedKeys: string[],
  mergedNodes: Map<string, MergedNode>,
  rootNode: ProductionNode,
): ProductionPlan {
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
      dependencies: [],
    });
  });

  return { rootNode, flatList, totalPowerConsumption, rawMaterialRequirements };
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
): ProductionNode {
  const item = maps.itemMap.get(itemId);
  if (!item) throw new Error(`Item not found: ${itemId}`);

  // If this item is already in the current processing path, it indicates a circular dependency.
  // Treat it as a raw material for this specific branch to break the cycle.
  if (visitedPath.has(itemId)) {
    return {
      item,
      targetRate: requiredRate,
      recipe: null,
      facility: null,
      facilityCount: 0,
      isRawMaterial: true,
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
      dependencies: [],
    };
  }

  let selectedRecipe: Recipe;
  if (recipeOverrides?.has(itemId)) {
    const overrideRecipe = maps.recipeMap.get(recipeOverrides.get(itemId)!);
    if (!overrideRecipe)
      throw new Error(`Override recipe not found for ${itemId}`);
    selectedRecipe = overrideRecipe;
  } else {
    selectedRecipe = recipeSelector(itemId, availableRecipes);
  }

  const facility = maps.facilityMap.get(selectedRecipe.facilityId);
  if (!facility)
    throw new Error(`Facility not found: ${selectedRecipe.facilityId}`);

  const outputAmount =
    selectedRecipe.outputs.find((o) => o.itemId === itemId)?.amount || 0;
  const cyclesPerMinute = 60 / selectedRecipe.craftingTime;
  const outputRatePerFacility = outputAmount * cyclesPerMinute;

  const facilityCount = requiredRate / outputRatePerFacility;

  // Add the current item to the visited path to detect circular dependencies in subsequent recursive calls.
  const newVisitedPath = new Set(visitedPath);
  newVisitedPath.add(itemId);

  const dependencies = selectedRecipe.inputs.map((input) => {
    const inputRate = input.amount * cyclesPerMinute * facilityCount;
    return calculateNode(
      input.itemId,
      inputRate,
      maps,
      recipeOverrides,
      recipeSelector,
      newVisitedPath,
    );
  });

  return {
    item,
    targetRate: requiredRate,
    recipe: selectedRecipe,
    facility,
    facilityCount,
    isRawMaterial: false,
    dependencies,
  };
}

/**
 * Calculates a complete production plan for a single target item at a specified rate.
 * The plan includes raw material requirements, total power consumption, and a detailed list of production steps.
 */
export function calculateProductionLine(
  targetItemId: ItemId,
  targetRate: number,
  items: Item[],
  recipes: Recipe[],
  facilities: Facility[],
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
): ProductionPlan {
  // Create lookup maps for efficient access to items, recipes, and facilities.
  const maps: ProductionMaps = {
    itemMap: new Map(items.map((i) => [i.id, i])),
    recipeMap: new Map(recipes.map((r) => [r.id, r])),
    facilityMap: new Map(facilities.map((f) => [f.id, f])),
  };

  const rootNode = calculateNode(
    targetItemId,
    targetRate,
    maps,
    recipeOverrides,
    recipeSelector,
  );

  const producedItemIds = collectProducedItems([rootNode]);
  const mergedNodes = mergeProductionNodes([rootNode], producedItemIds);
  const sortedKeys = topologicalSort(mergedNodes);
  const sortedByLevelAndTier = sortByLevelAndTier(sortedKeys, mergedNodes);

  return buildFinalPlan(sortedByLevelAndTier, mergedNodes, rootNode);
}

/**
 * Calculates a combined production plan for multiple target items at specified rates.
 * This function merges the requirements of all targets into a single, optimized production flow.
 */
export function calculateMultipleTargets(
  targets: Array<{ itemId: ItemId; rate: number }>,
  items: Item[],
  recipes: Recipe[],
  facilities: Facility[],
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
): ProductionPlan {
  if (targets.length === 0) throw new Error("No targets specified");

  // Create lookup maps for efficient access to items, recipes, and facilities.
  const maps: ProductionMaps = {
    itemMap: new Map(items.map((i) => [i.id, i])),
    recipeMap: new Map(recipes.map((r) => [r.id, r])),
    facilityMap: new Map(facilities.map((f) => [f.id, f])),
  };

  if (targets.length === 1)
    return calculateProductionLine(
      targets[0].itemId,
      targets[0].rate,
      items,
      recipes,
      facilities,
      recipeOverrides,
      recipeSelector,
    );

  // Generate individual production node trees for each target.
  const rootNodes = targets.map((t) =>
    calculateNode(t.itemId, t.rate, maps, recipeOverrides, recipeSelector),
  );

  // Identify all items that are produced by any recipe within the entire production graph.
  const producedItemIds = collectProducedItems(rootNodes);

  const mergedNodes = mergeProductionNodes(rootNodes, producedItemIds);

  const sortedKeys = topologicalSort(mergedNodes);
  const sortedByLevelAndTier = sortByLevelAndTier(sortedKeys, mergedNodes);

  // Create a placeholder root node for the combined production plan.
  const rootNode: ProductionNode = {
    item: {
      id: "__multi_target__" as ItemId,
      tier: 0,
    },
    targetRate: 0,
    recipe: null,
    facility: null,
    facilityCount: 0,
    isRawMaterial: false,
    dependencies: [],
  };

  return buildFinalPlan(sortedByLevelAndTier, mergedNodes, rootNode);
}
