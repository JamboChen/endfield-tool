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
  isCyclePlaceholder?: boolean;
  cycleItemId?: ItemId;
  isPartOfCycle?: boolean;
  cycleId?: string;
};

/**
 * Represents a detected production cycle in the dependency graph.
 */
export type DetectedCycle = {
  cycleId: string;
  involvedItemIds: ItemId[];
  breakPointItemId: ItemId;
  cycleNodes: ProductionNode[];
  netOutputs: Map<ItemId, number>;
};

/**
 * The unified output structure for the production plan.
 */
export type UnifiedProductionPlan = {
  dependencyRootNodes: ProductionNode[];
  flatList: ProductionNode[];
  totalPowerConsumption: number;
  rawMaterialRequirements: Map<ItemId, number>;
  manualRawMaterials?: Set<ItemId>;
  detectedCycles: DetectedCycle[];
  keyToLevel?: Map<string, number>;
};

export type RecipeSelector = (
  availableRecipes: Recipe[],
  visitedPath?: Set<ItemId>,
) => Recipe;

const defaultRecipeSelector: RecipeSelector = (recipes) => recipes[0];

export const smartRecipeSelector: RecipeSelector = (recipes, visitedPath) => {
  if (!visitedPath?.size) return defaultRecipeSelector(recipes);

  const nonCircular = recipes.filter(
    (r) => !r.inputs.some((input) => visitedPath.has(input.itemId)),
  );

  return nonCircular.length > 0 ? nonCircular[0] : recipes[0];
};

type ProductionMaps = {
  itemMap: Map<ItemId, Item>;
  recipeMap: Map<RecipeId, Recipe>;
  facilityMap: Map<FacilityId, Facility>;
};

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

// Helper: get value from map or throw
const getOrThrow = <K, V>(map: Map<K, V>, key: K, type: string): V => {
  const value = map.get(key);
  if (!value) throw new Error(`${type} not found: ${key}`);
  return value;
};

// Helper: calculate production rate per facility
const calcRate = (amount: number, craftingTime: number): number =>
  (amount * 60) / craftingTime;

// Helper: create node key
const createNodeKey = (
  itemId: ItemId,
  recipeId: RecipeId | null,
  isRaw: boolean,
): string => (isRaw ? `raw_${itemId}` : `${itemId}_${recipeId}`);

// Helper: generic tree traversal
const traverseTree = (
  nodes: ProductionNode[],
  visitor: (node: ProductionNode) => void,
  skipPlaceholders = true,
) => {
  const visit = (node: ProductionNode) => {
    if (skipPlaceholders && node.isCyclePlaceholder) return;
    visitor(node);
    node.dependencies.forEach(visit);
  };
  nodes.forEach(visit);
};

/** Collects all produced (non-raw) item IDs */
function collectProducedItems(nodes: ProductionNode[]): Set<ItemId> {
  const produced = new Set<ItemId>();
  traverseTree(nodes, (node) => {
    if (!node.isRawMaterial && node.recipe) {
      produced.add(node.item.id);
    }
  });
  return produced;
}

/** Checks if node is a circular dependency */
const isCircularDep = (node: ProductionNode, produced: Set<ItemId>): boolean =>
  !node.isCyclePlaceholder && node.isRawMaterial && produced.has(node.item.id);

/** Merges duplicate production nodes */
function mergeProductionNodes(
  rootNodes: ProductionNode[],
  producedItemIds: Set<ItemId>,
): Map<string, MergedNode> {
  const merged = new Map<string, MergedNode>();

  traverseTree(rootNodes, (node) => {
    if (isCircularDep(node, producedItemIds)) return;

    const key = createNodeKey(
      node.item.id,
      node.recipe?.id || null,
      node.isRawMaterial,
    );
    const existing = merged.get(key);

    if (existing) {
      existing.totalRate += node.targetRate;
      existing.totalFacilityCount += node.facilityCount;
      if (node.isTarget) existing.isTarget = true;

      node.dependencies.forEach((dep) => {
        if (!isCircularDep(dep, producedItemIds)) {
          existing.dependencies.add(
            createNodeKey(
              dep.item.id,
              dep.recipe?.id || null,
              dep.isRawMaterial,
            ),
          );
        }
      });
    } else {
      const dependencies = new Set<string>();
      node.dependencies.forEach((dep) => {
        if (!isCircularDep(dep, producedItemIds)) {
          dependencies.add(
            createNodeKey(
              dep.item.id,
              dep.recipe?.id || null,
              dep.isRawMaterial,
            ),
          );
        }
      });

      merged.set(key, {
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
  });

  return merged;
}

/** Topological sort from producers to consumers */
function topologicalSort(merged: Map<string, MergedNode>): string[] {
  const dependentCount = new Map<string, number>();

  merged.forEach((_, key) => dependentCount.set(key, 0));
  merged.forEach((node) => {
    node.dependencies.forEach((depKey) => {
      if (merged.has(depKey)) {
        dependentCount.set(depKey, (dependentCount.get(depKey) || 0) + 1);
      }
    });
  });

  const queue: string[] = [];
  dependentCount.forEach((count, key) => {
    if (count === 0) queue.push(key);
  });

  const sorted: string[] = [];
  while (queue.length > 0) {
    const key = queue.shift()!;
    sorted.push(key);

    merged.get(key)!.dependencies.forEach((depKey) => {
      if (merged.has(depKey)) {
        const newCount = dependentCount.get(depKey)! - 1;
        dependentCount.set(depKey, newCount);
        if (newCount === 0) queue.push(depKey);
      }
    });
  }

  return sorted.reverse();
}

/** Calculates depth levels for nodes */
function calculateNodeLevels(
  sortedKeys: string[],
  merged: Map<string, MergedNode>,
): Map<string, number> {
  const levels = new Map<string, number>();

  const calcLevel = (key: string): number => {
    if (levels.has(key)) return levels.get(key)!;

    const node = merged.get(key);
    if (!node || node.dependencies.size === 0) {
      levels.set(key, 0);
      return 0;
    }

    let maxDepLevel = -1;
    node.dependencies.forEach((depKey) => {
      if (merged.has(depKey)) {
        maxDepLevel = Math.max(maxDepLevel, calcLevel(depKey));
      }
    });

    const level = maxDepLevel + 1;
    levels.set(key, level);
    return level;
  };

  sortedKeys.forEach(calcLevel);
  return levels;
}

/** Sorts by level (deepest first) then tier (highest first) */
function sortByLevelAndTier(
  sortedKeys: string[],
  merged: Map<string, MergedNode>,
): string[] {
  const keyToLevel = calculateNodeLevels(sortedKeys, merged);
  const levels = new Map<number, string[]>();

  sortedKeys.forEach((key) => {
    const level = keyToLevel.get(key)!;
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level)!.push(key);
  });

  const result: string[] = [];
  Array.from(levels.keys())
    .sort((a, b) => b - a)
    .forEach((level) => {
      const keysInLevel = levels.get(level)!;
      keysInLevel.sort(
        (a, b) => merged.get(b)!.item.tier - merged.get(a)!.item.tier,
      );
      result.push(...keysInLevel);
    });

  return result;
}

/** Builds final plan components */
function buildFinalPlanComponents(
  sortedKeys: string[],
  merged: Map<string, MergedNode>,
): {
  flatList: ProductionNode[];
  totalPowerConsumption: number;
  rawMaterialRequirements: Map<ItemId, number>;
  keyToLevel: Map<string, number>;
} {
  const rawMaterials = new Map<ItemId, number>();
  let totalPower = 0;
  const flatList: ProductionNode[] = [];
  const keyToLevel = calculateNodeLevels(sortedKeys, merged);

  sortedKeys.forEach((key) => {
    const node = merged.get(key)!;
    const level = keyToLevel.get(key) || 0;

    if (node.isRawMaterial) {
      rawMaterials.set(
        node.item.id,
        (rawMaterials.get(node.item.id) || 0) + node.totalRate,
      );
    } else if (node.facility) {
      totalPower += node.facility.powerConsumption * node.totalFacilityCount;
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
    totalPowerConsumption: totalPower,
    rawMaterialRequirements: rawMaterials,
    keyToLevel,
  };
}

/** Reconstructs a cycle for visualization */
function reconstructCycle(
  cyclePath: ItemId[],
  maps: ProductionMaps,
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  manualRawMaterials?: Set<ItemId>,
): ProductionNode[] {
  const cycleNodes: ProductionNode[] = [];
  const pathSet = new Set(cyclePath);

  for (let i = 0; i < cyclePath.length; i++) {
    const itemId = cyclePath[i];
    const nextItemId = cyclePath[(i + 1) % cyclePath.length];

    if (manualRawMaterials?.has(itemId)) continue;

    const item = maps.itemMap.get(itemId);
    if (!item) continue;

    const availableRecipes = Array.from(maps.recipeMap.values()).filter((r) =>
      r.outputs.some((o) => o.itemId === itemId),
    );
    if (availableRecipes.length === 0) continue;

    let selectedRecipe: Recipe;
    if (recipeOverrides?.has(itemId)) {
      const override = maps.recipeMap.get(recipeOverrides.get(itemId)!);
      if (!override) continue;
      selectedRecipe = override;
    } else {
      const compatible = availableRecipes.filter((r) =>
        r.inputs.some((input) => input.itemId === nextItemId),
      );
      const recipesToSelect =
        compatible.length > 0 ? compatible : availableRecipes;
      selectedRecipe = recipeSelector(
        recipesToSelect,
        new Set(cyclePath.slice(0, i + 1)),
      );
    }

    const facility = maps.facilityMap.get(selectedRecipe.facilityId);
    if (!facility) continue;

    const outputAmount =
      selectedRecipe.outputs.find((o) => o.itemId === itemId)?.amount || 0;
    const rate = calcRate(outputAmount, selectedRecipe.craftingTime);
    const facilityCount = 1 / rate;

    const dependencies = selectedRecipe.inputs.map((input) => {
      const depItem = getOrThrow(maps.itemMap, input.itemId, "Dependency item");
      return {
        item: depItem,
        targetRate:
          calcRate(input.amount, selectedRecipe.craftingTime) * facilityCount,
        recipe: null,
        facility: null,
        facilityCount: 0,
        isRawMaterial: !pathSet.has(input.itemId),
        isTarget: false,
        dependencies: [],
      } as ProductionNode;
    });

    cycleNodes.push({
      item,
      targetRate: 1,
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

/** Calculates net outputs of a cycle */
function calculateCycleNetOutputs(
  cycleNodes: ProductionNode[],
): Map<ItemId, number> {
  const production = new Map<ItemId, number>();
  const consumption = new Map<ItemId, number>();

  cycleNodes.forEach((node) => {
    if (!node.recipe) return;

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

  const netOutputs = new Map<ItemId, number>();
  production.forEach((produced, itemId) => {
    const net = produced - (consumption.get(itemId) || 0);
    if (Math.abs(net) > 0.001) {
      netOutputs.set(itemId, net);
    }
  });

  return netOutputs;
}

/** Solves a 2-step cycle for steady-state operation */
function solveCycleForOutput(
  detectedCycle: DetectedCycle,
  targetItemId: ItemId,
  targetOutputRate: number,
  maps: ProductionMaps,
): Map<RecipeId, number> {
  const solution = new Map<RecipeId, number>();
  const { involvedItemIds: itemIds } = detectedCycle;
  const recipeIds = detectedCycle.cycleNodes
    .map((n) => n.recipe?.id)
    .filter(Boolean) as RecipeId[];

  if (itemIds.length !== 2 || recipeIds.length !== 2) {
    throw new Error(
      `Complex cycles with ${itemIds.length} steps not yet supported`,
    );
  }

  const [itemA, itemB] = itemIds;
  const [recipeAId, recipeBId] = recipeIds;
  const recipeA = getOrThrow(maps.recipeMap, recipeAId, "Recipe");
  const recipeB = getOrThrow(maps.recipeMap, recipeBId, "Recipe");

  const recipeForA = recipeA.outputs.some((o) => o.itemId === itemA)
    ? recipeA
    : recipeB;
  const recipeForB = recipeA.outputs.some((o) => o.itemId === itemB)
    ? recipeA
    : recipeB;

  const outputA = recipeForA.outputs.find((o) => o.itemId === itemA)!;
  const outputB = recipeForB.outputs.find((o) => o.itemId === itemB)!;
  const rateA = calcRate(outputA.amount, recipeForA.craftingTime);
  const rateB = calcRate(outputB.amount, recipeForB.craftingTime);

  const inputAinB = recipeForB.inputs.find((i) => i.itemId === itemA);
  const inputBinA = recipeForA.inputs.find((i) => i.itemId === itemB);
  const consumeA = inputAinB
    ? calcRate(inputAinB.amount, recipeForB.craftingTime)
    : 0;
  const consumeB = inputBinA
    ? calcRate(inputBinA.amount, recipeForA.craftingTime)
    : 0;

  const netA = targetItemId === itemA ? targetOutputRate : 0;
  const netB = targetItemId === itemB ? targetOutputRate : 0;

  const coeffA = rateA - (consumeB * consumeA) / rateB;
  const rhsA = netA + (netB * consumeA) / rateB;

  const countA = rhsA / coeffA;
  const countB = (countA * consumeB + netB) / rateB;

  solution.set(recipeForA.id, countA);
  solution.set(recipeForB.id, countB);

  return solution;
}

/** Builds dependency tree and detects cycles */
function buildDependencyTree(
  targets: Array<{ itemId: ItemId; rate: number }>,
  maps: ProductionMaps,
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  manualRawMaterials?: Set<ItemId>,
): { rootNodes: ProductionNode[]; detectedCycles: DetectedCycle[] } {
  const detectedCycles: DetectedCycle[] = [];

  const calculateNode = (
    itemId: ItemId,
    requiredRate: number,
    visitedPath: Set<ItemId>,
    isDirectTarget: boolean,
  ): ProductionNode => {
    const item = getOrThrow(maps.itemMap, itemId, "Item");

    // Check for cycle
    if (visitedPath.has(itemId)) {
      const pathArray = Array.from(visitedPath);
      const cyclePath = pathArray.slice(pathArray.indexOf(itemId));
      const cycleId = `cycle-${[...cyclePath].sort().join("-")}`;

      // Check if cycle already detected
      const isDuplicate = detectedCycles.some((c) => {
        if (c.involvedItemIds.length !== cyclePath.length) return false;
        const cycleSet = new Set(cyclePath);
        return c.involvedItemIds.every((id) => cycleSet.has(id));
      });

      if (!isDuplicate) {
        const cycleNodes = reconstructCycle(
          cyclePath,
          maps,
          recipeOverrides,
          recipeSelector,
          manualRawMaterials,
        );

        detectedCycles.push({
          cycleId,
          involvedItemIds: cyclePath,
          breakPointItemId: itemId,
          cycleNodes,
          netOutputs: calculateCycleNetOutputs(cycleNodes),
        });
      }

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

    // Check if raw material
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

    const newVisitedPath = new Set(visitedPath);
    newVisitedPath.add(itemId);

    const selectedRecipe = recipeOverrides?.has(itemId)
      ? getOrThrow(
          maps.recipeMap,
          recipeOverrides.get(itemId)!,
          "Override recipe",
        )
      : recipeSelector(availableRecipes, newVisitedPath);

    const facility = getOrThrow(
      maps.facilityMap,
      selectedRecipe.facilityId,
      "Facility",
    );
    const outputAmount =
      selectedRecipe.outputs.find((o) => o.itemId === itemId)?.amount || 0;
    const outputRatePerFacility = calcRate(
      outputAmount,
      selectedRecipe.craftingTime,
    );
    const facilityCount = requiredRate / outputRatePerFacility;
    const cyclesPerMinute = 60 / selectedRecipe.craftingTime;

    const dependencies = selectedRecipe.inputs.map((input) => {
      const inputRate = input.amount * cyclesPerMinute * facilityCount;
      return calculateNode(input.itemId, inputRate, newVisitedPath, false);
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
    calculateNode(t.itemId, t.rate, new Set(), true),
  );

  // Solve cycles and update facility counts
  detectedCycles.forEach((cycle) => {
    const cycleItemSet = new Set(cycle.involvedItemIds);
    const externalConsumption = new Map<ItemId, number>();

    const findExternalConsumption = (node: ProductionNode, inCycle = false) => {
      if (node.isCyclePlaceholder) return;

      const nodeIsInCycle =
        cycleItemSet.has(node.item.id) && !node.isRawMaterial;

      if (!nodeIsInCycle && !inCycle) {
        node.dependencies.forEach((dep) => {
          if (dep.isCyclePlaceholder) return;
          if (cycleItemSet.has(dep.item.id) && !dep.isRawMaterial) {
            externalConsumption.set(
              dep.item.id,
              (externalConsumption.get(dep.item.id) || 0) + dep.targetRate,
            );
          }
        });
      }

      node.dependencies.forEach((dep) =>
        findExternalConsumption(dep, nodeIsInCycle || inCycle),
      );
    };

    rootNodes.forEach((node) => findExternalConsumption(node));

    if (externalConsumption.size === 0) return;

    // Find primary extraction point
    let extractionItemId: ItemId | null = null;
    let maxConsumption = 0;
    for (const [itemId, rate] of externalConsumption) {
      if (rate > maxConsumption) {
        maxConsumption = rate;
        extractionItemId = itemId;
      }
    }

    if (!extractionItemId) return;

    try {
      const solution = solveCycleForOutput(
        cycle,
        extractionItemId,
        maxConsumption,
        maps,
      );

      const updateCycleNodes = (node: ProductionNode) => {
        if (node.isCyclePlaceholder) {
          node.dependencies.forEach(updateCycleNodes);
          return;
        }

        if (node.recipe && solution.has(node.recipe.id)) {
          const solvedCount = solution.get(node.recipe.id)!;
          node.facilityCount = solvedCount;
          node.isPartOfCycle = true;
          node.cycleId = cycle.cycleId;

          node.recipe.inputs.forEach((input, index) => {
            if (node.dependencies[index]) {
              node.dependencies[index].targetRate =
                calcRate(input.amount, node.recipe!.craftingTime) * solvedCount;
            }
          });
        }

        node.dependencies.forEach(updateCycleNodes);
      };

      rootNodes.forEach(updateCycleNodes);
    } catch (error) {
      console.error(`Failed to solve cycle ${cycle.cycleId}:`, error);
    }
  });

  return { rootNodes, detectedCycles };
}

/** Processes raw dependency trees into merged plan */
function processMergedPlan(rootNodes: ProductionNode[]): Omit<
  UnifiedProductionPlan,
  "dependencyRootNodes"
> & {
  keyToLevel: Map<string, number>;
} {
  const producedItemIds = collectProducedItems(rootNodes);
  const mergedNodes = mergeProductionNodes(rootNodes, producedItemIds);
  const sortedKeys = topologicalSort(mergedNodes);
  const sortedByLevelAndTier = sortByLevelAndTier(sortedKeys, mergedNodes);

  return {
    ...buildFinalPlanComponents(sortedByLevelAndTier, mergedNodes),
    detectedCycles: [],
  };
}

/**
 * Calculates a complete production plan for multiple target items at specified rates.
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
