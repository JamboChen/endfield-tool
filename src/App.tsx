import { calculateMultipleTargets } from "./lib/calculator";
import { items, recipes, facilities } from "./data";
import { useState, useMemo, useCallback } from "react";
import ProductionTable from "./components/ProductionTable";
import type { ProductionTarget } from "./components/TargetItemsGrid";
import AddTargetDialogGrid from "./components/AddTargetDialogGrid";
import LeftPanel from "./components/LeftPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ItemId, RecipeId } from "@/types";
import type { ProductionLineData } from "./components/ProductionTable";
import { useTranslation } from "react-i18next";

export default function App() {
  const { t, i18n } = useTranslation("app");

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };
  const [targets, setTargets] = useState<ProductionTarget[]>([]);
  const [recipeOverrides, setRecipeOverrides] = useState<Map<ItemId, RecipeId>>(
    new Map(),
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const { plan, tableData, error } = useMemo(() => {
    let plan = null;
    let tableData: ProductionLineData[] = [];
    let error: string | null = null;

    try {
      if (targets.length > 0) {
        plan = calculateMultipleTargets(
          targets,
          items,
          recipes,
          facilities,
          recipeOverrides,
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
          };
        });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "计算错误";
    }

    return { plan, tableData, error };
  }, [targets, recipeOverrides]);

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

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col p-4 gap-4">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <div className="flex items-center gap-4">
            {/* 语言切换按钮 */}
            <Select value={i18n.language} onValueChange={handleLanguageChange}>
              <SelectTrigger className="w-[120px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh-Hans">简体中文</SelectItem>
                <SelectItem value="zh-Hant">繁體中文</SelectItem>
              </SelectContent>
            </Select>
            <a
              href="https://github.com/JamboChen/endfield-tool"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <img
                height="16"
                width="16"
                src="https://cdn.simpleicons.org/github/181717"
              />
              <span>GitHub</span>
            </a>
          </div>
        </div>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* 左侧面板 */}
          <LeftPanel
            targets={targets}
            items={items}
            totalPowerConsumption={plan?.totalPowerConsumption ?? 0}
            productionSteps={tableData.length}
            rawMaterialCount={plan?.rawMaterialRequirements.size ?? 0}
            error={error}
            onTargetChange={handleTargetChange}
            onTargetRemove={handleTargetRemove}
            onAddClick={handleAddClick}
          />

          {/* 右侧面板 */}
          <div className="flex-1 min-w-0">
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-3 shrink-0">
                <CardTitle className="text-base">
                  {t("productionConfig")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-auto">
                <ProductionTable
                  data={tableData}
                  items={items}
                  facilities={facilities}
                  onRecipeChange={handleRecipeChange}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <AddTargetDialogGrid
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          items={items}
          existingTargetIds={targets.map((t) => t.itemId)}
          onAddTarget={handleAddTarget}
        />
      </div>
    </TooltipProvider>
  );
}
