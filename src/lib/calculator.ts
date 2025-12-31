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
  level?: number;

  // Cycle support fields
  isCyclePlaceholder?: boolean; // Marks a node that points back to create a cycle
  cycleItemId?: ItemId; // The item this placeholder points back to
  isPartOfCycle?: boolean; // Whether this node participates in a cycle
  cycleId?: string; // ID of the cycle this node belongs to
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
  keyToLevel?: Map<string, number>;
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
    // Skip cycle placeholders - they reference items produced elsewhere
    if (node.isCyclePlaceholder) {
      return;
    }

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
  // Cycle placeholders are not circular dependencies - they're intentional back-references
  if (node.isCyclePlaceholder) {
    return false;
  }

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
  keyToLevel: Map<string, number>;
} {
  const rawMaterialRequirements = new Map<ItemId, number>();
  let totalPowerConsumption = 0;
  const flatList: ProductionNode[] = [];

  const keyToLevel = calculateNodeLevels(sortedKeys, mergedNodes);

  sortedKeys.forEach((key) => {
    const node = mergedNodes.get(key)!;
    const level = keyToLevel.get(key) || 0;

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
      level,
    });
  });

  return {
    flatList,
    totalPowerConsumption,
    rawMaterialRequirements,
    detectedCycles: [],
    keyToLevel,
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
 * Solves a self-sufficient production cycle to determine facility counts.
 *
 * For a cycle like Plant → Seed×2 → Plant with target output of 1 Plant/min:
 * - Sets up linear equations for production balance
 * - Solves for facility counts that achieve steady-state with desired output
 *
 * @param detectedCycle The cycle information
 * @param targetItemId Which item to extract from the cycle
 * @param targetOutputRate Desired net output rate (items/min)
 * @param maps Item/Recipe/Facility lookup maps
 * @returns Map of recipeId -> facility count for steady-state operation
 */
function solveCycleForOutput(
  detectedCycle: DetectedCycle,
  targetItemId: ItemId,
  targetOutputRate: number,
  maps: ProductionMaps,
): Map<RecipeId, number> {
  const solution = new Map<RecipeId, number>();

  // Verify the target item is part of the cycle
  if (!detectedCycle.involvedItemIds.includes(targetItemId)) {
    throw new Error(
      `Target item ${targetItemId} is not part of cycle ${detectedCycle.cycleId}`,
    );
  }

  const itemIds = detectedCycle.involvedItemIds;
  const recipeIds: RecipeId[] = [];

  // Find the recipe for each item in the cycle
  detectedCycle.cycleNodes.forEach((node) => {
    if (node.recipe) {
      recipeIds.push(node.recipe.id);
    }
  });

  // Simple 2-step cycle solver (can be extended for complex cycles)
  if (itemIds.length === 2 && recipeIds.length === 2) {
    const [itemA, itemB] = itemIds;
    const recipeA = maps.recipeMap.get(recipeIds[0])!;
    const recipeB = maps.recipeMap.get(recipeIds[1])!;

    // Determine which recipe produces which item
    const recipeForA = recipeA.outputs.some((o) => o.itemId === itemA)
      ? recipeA
      : recipeB;
    const recipeForB = recipeA.outputs.some((o) => o.itemId === itemB)
      ? recipeA
      : recipeB;

    // Calculate production rates per facility (items per minute)
    const outputA = recipeForA.outputs.find((o) => o.itemId === itemA)!;
    const outputB = recipeForB.outputs.find((o) => o.itemId === itemB)!;
    const rateA = (outputA.amount * 60) / recipeForA.craftingTime;
    const rateB = (outputB.amount * 60) / recipeForB.craftingTime;

    // Calculate consumption rates per facility (items per minute)
    const inputAinB = recipeForB.inputs.find((i) => i.itemId === itemA);
    const inputBinA = recipeForA.inputs.find((i) => i.itemId === itemB);

    const consumeA = inputAinB
      ? (inputAinB.amount * 60) / recipeForB.craftingTime
      : 0;
    const consumeB = inputBinA
      ? (inputBinA.amount * 60) / recipeForA.craftingTime
      : 0;

    // Solve the system:
    // For item A: countA * rateA = countB * consumeA + netOutputA
    // For item B: countB * rateB = countA * consumeB + netOutputB

    const netOutputA = targetItemId === itemA ? targetOutputRate : 0;
    const netOutputB = targetItemId === itemB ? targetOutputRate : 0;

    // From equation B: countB = (countA * consumeB + netOutputB) / rateB
    // Substitute into A: countA * rateA = ((countA * consumeB + netOutputB) / rateB) * consumeA + netOutputA
    // Simplify: countA * rateA = countA * consumeB * consumeA / rateB + netOutputB * consumeA / rateB + netOutputA
    // countA * (rateA - consumeB * consumeA / rateB) = netOutputA + netOutputB * consumeA / rateB

    const coeffA = rateA - (consumeB * consumeA) / rateB;
    const rhsA = netOutputA + (netOutputB * consumeA) / rateB;

    const countA = rhsA / coeffA;
    const countB = (countA * consumeB + netOutputB) / rateB;

    solution.set(recipeForA.id, countA);
    solution.set(recipeForB.id, countB);
  } else {
    // For more complex cycles, use general linear solver (placeholder for now)
    throw new Error(
      `Complex cycles with ${itemIds.length} steps not yet supported`,
    );
  }

  return solution;
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

  // First pass: build tree and detect cycles (without solving them yet)
  const calculateNodeFirstPass = (
    itemId: ItemId,
    requiredRate: number,
    visitedPath: Set<ItemId>,
    isDirectTarget: boolean,
    currentCycleId?: string,
  ): ProductionNode => {
    const item = maps.itemMap.get(itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);

    // Check for circular dependency
    if (visitedPath.has(itemId)) {
      // Reconstruct cycle path
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

      // Return a placeholder node that points back to create the cycle
      return {
        item,
        targetRate: requiredRate,
        recipe: null,
        facility: null,
        facilityCount: 0,
        isRawMaterial: false,
        isTarget: false,
        dependencies: [],
        isCyclePlaceholder: true,
        cycleItemId: itemId,
        cycleId,
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

    // Add current item to visited path
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

    // Production rate calculation (temporary, will be updated for cycles)
    const outputAmount =
      selectedRecipe.outputs.find((o) => o.itemId === itemId)?.amount || 0;
    const cyclesPerMinute = 60 / selectedRecipe.craftingTime;
    const outputRatePerFacility = outputAmount * cyclesPerMinute;

    // Calculate required facilities (temporary for non-cycle nodes)
    const facilityCount = requiredRate / outputRatePerFacility;

    // Recursively calculate dependencies
    const dependencies = selectedRecipe.inputs.map((input) => {
      const inputRate = input.amount * cyclesPerMinute * facilityCount;
      return calculateNodeFirstPass(
        input.itemId,
        inputRate,
        newVisitedPath,
        false,
        currentCycleId,
      );
    });

    const node: ProductionNode = {
      item,
      targetRate: requiredRate,
      recipe: selectedRecipe,
      facility,
      facilityCount,
      isRawMaterial: false,
      isTarget: isDirectTarget,
      dependencies,
      isPartOfCycle: currentCycleId !== undefined,
      cycleId: currentCycleId,
    };

    return node;
  };

  // Build initial tree
  const rootNodes = targets.map((t) =>
    calculateNodeFirstPass(t.itemId, t.rate, new Set(), true),
  );

  // Second pass: solve cycles and update facility counts
  detectedCycles.forEach((cycle) => {
    const cycleItemSet = new Set(cycle.involvedItemIds);

    // Find all consumption of cycle items from outside the cycle
    // Strategy: traverse the tree and find nodes that consume cycle items
    // but are not themselves part of the cycle
    const externalConsumption = new Map<ItemId, number>();

    const findExternalConsumption = (
      node: ProductionNode,
      ancestorInCycle: boolean = false,
    ) => {
      // Skip placeholders
      if (node.isCyclePlaceholder) {
        return;
      }

      const nodeIsInCycle =
        cycleItemSet.has(node.item.id) && !node.isRawMaterial;

      // If current node is NOT in cycle but has dependencies that ARE in cycle,
      // those dependencies represent external consumption
      if (!nodeIsInCycle && !ancestorInCycle) {
        node.dependencies.forEach((dep) => {
          // Skip placeholders
          if (dep.isCyclePlaceholder) {
            return;
          }

          const depIsInCycle =
            cycleItemSet.has(dep.item.id) && !dep.isRawMaterial;

          if (depIsInCycle) {
            const current = externalConsumption.get(dep.item.id) || 0;
            externalConsumption.set(dep.item.id, current + dep.targetRate);
          }
        });
      }

      // Continue traversing (mark if we're now inside the cycle)
      node.dependencies.forEach((dep) => {
        findExternalConsumption(dep, nodeIsInCycle || ancestorInCycle);
      });
    };

    rootNodes.forEach((node) => findExternalConsumption(node));

    if (externalConsumption.size === 0) {
      console.warn("No external consumption found for cycle:", cycle.cycleId);
      return;
    }

    // Find the item with the most external consumption (primary extraction point)
    let extractionItemId: ItemId | null = null;
    let maxConsumption = 0;

    for (const [itemId, rate] of externalConsumption.entries()) {
      if (rate > maxConsumption) {
        maxConsumption = rate;
        extractionItemId = itemId;
      }
    }

    if (!extractionItemId) {
      console.warn(
        "Could not determine extraction point for cycle:",
        cycle.cycleId,
      );
      return;
    }

    try {
      // Solve the cycle for the extraction point
      const solution = solveCycleForOutput(
        cycle,
        extractionItemId,
        maxConsumption,
        maps,
      );

      // Update nodes in the tree with solved facility counts
      const updateCycleNodes = (node: ProductionNode) => {
        // Skip placeholders - they don't have recipes
        if (node.isCyclePlaceholder) {
          node.dependencies.forEach(updateCycleNodes);
          return;
        }

        if (node.recipe && solution.has(node.recipe.id)) {
          const solvedCount = solution.get(node.recipe.id)!;

          node.facilityCount = solvedCount;
          node.isPartOfCycle = true;
          node.cycleId = cycle.cycleId;

          // Recalculate dependency rates based on solved facility count
          const cyclesPerMinute = 60 / node.recipe.craftingTime;
          node.recipe.inputs.forEach((input, index) => {
            if (node.dependencies[index]) {
              const inputRate = input.amount * cyclesPerMinute * solvedCount;
              node.dependencies[index].targetRate = inputRate;

              // Also update the targetRate of the dependency node itself
              updateDependencyRate(node.dependencies[index], inputRate);
            }
          });
        }

        node.dependencies.forEach(updateCycleNodes);
      };

      // Helper to update a node's targetRate (used for cycle feedback)
      const updateDependencyRate = (node: ProductionNode, newRate: number) => {
        node.targetRate = newRate;

        // If this node has a recipe, recalculate its dependencies
        if (node.recipe && !node.isCyclePlaceholder) {
          const recipe = node.recipe;
          if (!recipe || node.isCyclePlaceholder) {
            return;
          }

          const cyclesPerMinute = 60 / recipe.craftingTime;

          const output = recipe.outputs.find((o) => o.itemId === node.item.id);

          if (!output) {
            return;
          }

          node.recipe.inputs.forEach((input, index) => {
            const dependency = node.dependencies[index];
            if (!dependency) return;

            const inputRate =
              input.amount *
              cyclesPerMinute *
              (newRate / output.amount / cyclesPerMinute);

            dependency.targetRate = inputRate;
          });
        }
      };

      rootNodes.forEach(updateCycleNodes);
    } catch (error) {
      console.error(`Failed to solve cycle ${cycle.cycleId}:`, error);
    }
  });

  return { rootNodes, detectedCycles };
}

/**
 * Processes the raw dependency trees to create a merged, sorted, and flattened production plan.
 */
function processMergedPlan(rootNodes: ProductionNode[]): Omit<
  UnifiedProductionPlan,
  "dependencyRootNodes"
> & {
  keyToLevel: Map<string, number>;
} {
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

  const maps: ProductionMaps = {
    itemMap: new Map(items.map((i) => [i.id, i])),
    recipeMap: new Map(recipes.map((r) => [r.id, r])),
    facilityMap: new Map(facilities.map((f) => [f.id, f])),
  };

  const { rootNodes: dependencyRootNodes, detectedCycles } =
    buildDependencyTree(
      targets,
      maps,
      recipeOverrides,
      recipeSelector,
      manualRawMaterials,
    );

  const {
    flatList,
    totalPowerConsumption,
    rawMaterialRequirements,
    keyToLevel,
  } = processMergedPlan(dependencyRootNodes);

  return {
    dependencyRootNodes,
    flatList,
    totalPowerConsumption,
    rawMaterialRequirements,
    detectedCycles,
    keyToLevel,
  };
}
