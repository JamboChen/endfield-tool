import type { Item, Recipe, Facility, ItemId, RecipeId } from "@/types";

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

/**
 * 递归计算单个节点
 */
function calculateNode(
  itemId: ItemId,
  requiredRate: number,
  items: Item[],
  recipes: Recipe[],
  facilities: Facility[],
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  visitedPath: Set<ItemId> = new Set(),
): ProductionNode {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const recipeMap = new Map(recipes.map((r) => [r.id, r]));
  const facilityMap = new Map(facilities.map((f) => [f.id, f]));

  const item = itemMap.get(itemId);
  if (!item) throw new Error(`Item not found: ${itemId}`);

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

  const availableRecipes = recipes.filter((r) =>
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
    const overrideRecipe = recipeMap.get(recipeOverrides.get(itemId)!);
    if (!overrideRecipe)
      throw new Error(`Override recipe not found for ${itemId}`);
    selectedRecipe = overrideRecipe;
  } else {
    selectedRecipe = recipeSelector(itemId, availableRecipes);
  }

  const facility = facilityMap.get(selectedRecipe.facilityId);
  if (!facility)
    throw new Error(`Facility not found: ${selectedRecipe.facilityId}`);

  const outputAmount =
    selectedRecipe.outputs.find((o) => o.itemId === itemId)?.amount || 0;
  const cyclesPerMinute = 60 / selectedRecipe.craftingTime;
  const outputRatePerFacility = outputAmount * cyclesPerMinute;

  const facilityCount = requiredRate / outputRatePerFacility;

  const newVisitedPath = new Set(visitedPath);
  newVisitedPath.add(itemId);
  const dependencies = selectedRecipe.inputs.map((input) => {
    const inputRate = input.amount * cyclesPerMinute * facilityCount;
    return calculateNode(
      input.itemId,
      inputRate,
      items,
      recipes,
      facilities,
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
 * 计算单目标生产线
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
  const rootNode = calculateNode(
    targetItemId,
    targetRate,
    items,
    recipes,
    facilities,
    recipeOverrides,
    recipeSelector,
  );

  const flatList: ProductionNode[] = [];
  const rawMaterialRequirements = new Map<ItemId, number>();
  let totalPowerConsumption = 0;

  const traverse = (node: ProductionNode) => {
    flatList.push(node);
    if (node.isRawMaterial) {
      rawMaterialRequirements.set(
        node.item.id,
        (rawMaterialRequirements.get(node.item.id) || 0) + node.targetRate,
      );
    } else if (node.facility) {
      totalPowerConsumption +=
        node.facility.powerConsumption * node.facilityCount;
    }
    node.dependencies.forEach(traverse);
  };

  traverse(rootNode);

  return { rootNode, flatList, totalPowerConsumption, rawMaterialRequirements };
}

/**
 * 计算多目标生产线（合并结果）
 */
export function calculateMultipleTargets(
  targets: Array<{ itemId: ItemId; rate: number }>,
  items: Item[],
  recipes: Recipe[],
  facilities: Facility[],
  recipeOverrides?: Map<ItemId, RecipeId>,
): ProductionPlan {
  if (targets.length === 0) throw new Error("No targets specified");
  if (targets.length === 1)
    return calculateProductionLine(
      targets[0].itemId,
      targets[0].rate,
      items,
      recipes,
      facilities,
      recipeOverrides,
    );

  const plans = targets.map((t) =>
    calculateProductionLine(
      t.itemId,
      t.rate,
      items,
      recipes,
      facilities,
      recipeOverrides,
    ),
  );

  const mergedNodes = new Map<
    string,
    {
      item: Item;
      totalRate: number;
      recipe: Recipe | null;
      facility: Facility | null;
      totalFacilityCount: number;
      isRawMaterial: boolean;
    }
  >();

  plans.forEach((plan) => {
    plan.flatList.forEach((node) => {
      const key = node.isRawMaterial
        ? `raw_${node.item.id}`
        : `${node.item.id}_${node.recipe?.id}`;
      const existing = mergedNodes.get(key);
      if (existing) {
        existing.totalRate += node.targetRate;
        existing.totalFacilityCount += node.facilityCount;
      } else {
        mergedNodes.set(key, {
          item: node.item,
          totalRate: node.targetRate,
          recipe: node.recipe,
          facility: node.facility,
          totalFacilityCount: node.facilityCount,
          isRawMaterial: node.isRawMaterial,
        });
      }
    });
  });

  let totalPowerConsumption = 0;
  const rawMaterialRequirements = new Map<ItemId, number>();
  const flatList: ProductionNode[] = [];

  mergedNodes.forEach((node) => {
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

  const rootNode: ProductionNode = {
    item: {
      id: "__multi_target__" as ItemId,
      name: { en: "Multiple Targets" },
      tier: 0,
    },
    targetRate: 0,
    recipe: null,
    facility: null,
    facilityCount: 0,
    isRawMaterial: false,
    dependencies: [],
  };

  return { rootNode, flatList, totalPowerConsumption, rawMaterialRequirements };
}
