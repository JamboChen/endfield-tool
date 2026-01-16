import type {
  Item,
  Recipe,
  Facility,
  ItemId,
  RecipeId,
  FacilityId,
  ProductionNode,
  DetectedCycle,
  ProductionDependencyGraph,
} from "@/types";
import { solveLinearSystem } from "./linear-solver";

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

// Helper: get value from map or throw
const getOrThrow = <K, V>(map: Map<K, V>, key: K, type: string): V => {
  const value = map.get(key);
  if (!value) throw new Error(`${type} not found: ${key}`);
  return value;
};

// Helper: calculate production rate per facility
const calcRate = (amount: number, craftingTime: number): number =>
  (amount * 60) / craftingTime;

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

/** Solves an SCC using linear equations */
function solveSCC(
  involvedItemIds: ItemId[],
  cycleNodes: ProductionNode[],
  externalDemands: Map<ItemId, number>,
): Map<RecipeId, number> | null {
  const recipes = cycleNodes.map((n) => n.recipe).filter(Boolean) as Recipe[];

  const n = involvedItemIds.length;
  // We need n recipes to solve for n items
  if (recipes.length !== n) return null;

  const matrix: number[][] = [];
  const constants: number[] = [];

  for (let i = 0; i < n; i++) {
    const itemId = involvedItemIds[i];
    const row = new Array(n).fill(0);

    for (let j = 0; j < n; j++) {
      const recipe = recipes[j];
      const output =
        recipe.outputs.find((o) => o.itemId === itemId)?.amount || 0;
      const input =
        recipe.inputs.find((inpt) => inpt.itemId === itemId)?.amount || 0;

      const outRate = (output * 60) / recipe.craftingTime;
      const inRate = (input * 60) / recipe.craftingTime;
      row[j] = outRate - inRate;
    }

    matrix.push(row);
    constants.push(externalDemands.get(itemId) || 0);
  }

  const solution = solveLinearSystem(matrix, constants);
  if (!solution) return null;

  const recipeCounts = new Map<RecipeId, number>();
  for (let i = 0; i < n; i++) {
    // If any facility count is significantly negative, the cycle is unsustainable
    if (solution[i] < -1e-9) return null;
    recipeCounts.set(recipes[i].id, Math.max(0, solution[i]));
  }

  return recipeCounts;
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

    // Add demand from targets if they are in the SCC
    // This is necessary because findExternalConsumption starts from rootNodes (recipes),
    // but the initial production target itself is not a recipe dependency.
    targets.forEach((t) => {
      if (cycleItemSet.has(t.itemId)) {
        externalConsumption.set(
          t.itemId,
          (externalConsumption.get(t.itemId) || 0) + t.rate,
        );
      }
    });

    if (externalConsumption.size === 0) return;

    try {
      const solution = solveSCC(
        cycle.involvedItemIds,
        cycle.cycleNodes,
        externalConsumption,
      );

      if (!solution) {
        console.warn(`Cycle ${cycle.cycleId} has no valid solution`);
        return;
      }

      const updateCycleNodes = (node: ProductionNode) => {
        if (node.isCyclePlaceholder) {
          node.dependencies.forEach(updateCycleNodes);
          return;
        }

        if (node.recipe && solution.has(node.recipe.id)) {
          const solvedCount = solution.get(node.recipe.id)!;
          node.facilityCount = solvedCount;

          // Update the node's own targetRate based on its output
          const mainOutput = node.recipe.outputs.find(
            (o) => o.itemId === node.item.id,
          );
          if (mainOutput) {
            node.targetRate =
              calcRate(mainOutput.amount, node.recipe.craftingTime) *
              solvedCount;
          }

          // Update dependencies' targetRate
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
): ProductionDependencyGraph {
  if (targets.length === 0) throw new Error("No targets specified");

  const maps: ProductionMaps = {
    itemMap: new Map(items.map((i) => [i.id, i])),
    recipeMap: new Map(recipes.map((r) => [r.id, r])),
    facilityMap: new Map(facilities.map((f) => [f.id, f])),
  };

  // Only build dependency tree and detect cycles
  const { rootNodes: dependencyRootNodes, detectedCycles } =
    buildDependencyTree(
      targets,
      maps,
      recipeOverrides,
      recipeSelector,
      manualRawMaterials,
    );

  return {
    dependencyRootNodes,
    detectedCycles,
  };
}
