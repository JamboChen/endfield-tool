import {
  calculateProductionPlan,
  smartRecipeSelector,
  type UnifiedProductionPlan,
} from "../lib/calculator";
import { items, recipes, facilities } from "../data";
import { useState, useMemo, useCallback } from "react";
import type { ProductionTarget } from "../components/TargetItemsGrid";
import type { ItemId, RecipeId } from "../types";
import type { ProductionLineData } from "../components/ProductionTable";
import { useTranslation } from "react-i18next";

export function useProductionPlan() {
  const { t } = useTranslation("app");

  const [targets, setTargets] = useState<ProductionTarget[]>([]);
  const [recipeOverrides, setRecipeOverrides] = useState<Map<ItemId, RecipeId>>(
    new Map(),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"table" | "tree">("table");
  const [manualRawMaterials, setManualRawMaterials] = useState<Set<ItemId>>(
    new Set(),
  );

  const { plan, tableData, error } = useMemo(() => {
    let plan: UnifiedProductionPlan | null = null;
    let tableData: ProductionLineData[] = [];
    let error: string | null = null;

    try {
      if (targets.length > 0) {
        plan = calculateProductionPlan(
          targets,
          items,
          recipes,
          facilities,
          recipeOverrides,
          smartRecipeSelector,
          manualRawMaterials,
        );

        tableData = plan.flatList.map((node) => {
          const availableRecipes = recipes.filter((recipe) =>
            recipe.outputs.some((output) => output.itemId === node.item.id),
          );

          return {
            item: node.item,
            outputRate: node.targetRate,
            availableRecipes: availableRecipes,
            selectedRecipeId: node.recipe?.id ?? "",
            facility: node.facility ?? null,
            facilityCount: node.facilityCount ?? 0,
            isRawMaterial: node.isRawMaterial,
            isTarget: node.isTarget,
            isManualRawMaterial: manualRawMaterials.has(node.item.id),
          };
        });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : t("calculationError");
    }

    return { plan, tableData, error };
  }, [targets, recipeOverrides, manualRawMaterials, t]);

  const handleTargetChange = useCallback((index: number, rate: number) => {
    setTargets((prev) => {
      const newTargets = [...prev];
      newTargets[index].rate = rate;
      return newTargets;
    });
  }, []);

  const handleTargetRemove = useCallback((index: number) => {
    setTargets((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddTarget = useCallback((itemId: ItemId, rate: number) => {
    setTargets((prev) => [...prev, { itemId, rate }]);
  }, []);

  const handleRecipeChange = useCallback(
    (itemId: ItemId, recipeId: RecipeId) => {
      setRecipeOverrides((prev) => {
        const newMap = new Map(prev);
        newMap.set(itemId, recipeId);
        return newMap;
      });
    },
    [],
  );

  const handleAddClick = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleToggleRawMaterial = useCallback((itemId: ItemId) => {
    setManualRawMaterials((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  }, []);

  return {
    targets,
    setTargets,
    recipeOverrides,
    setRecipeOverrides,
    dialogOpen,
    setDialogOpen,
    activeTab,
    setActiveTab,
    plan,
    tableData,
    error,
    handleTargetChange,
    handleTargetRemove,
    handleAddTarget,
    handleToggleRawMaterial,
    handleRecipeChange,
    handleAddClick,
  };
}
