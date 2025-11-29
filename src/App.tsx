import { calculateMultipleTargets } from "./lib/calculator";
import { items, recipes, facilities } from "./data";
import { useState, useMemo } from "react";
import ProductionTable from "./components/ProductionTable";
import TargetItemsGrid, {
  type ProductionTarget,
} from "./components/TargetItemsGrid";
import AddTargetDialogGrid from "./components/AddTargetDialogGrid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertCircle } from "lucide-react";
import type { ItemId, RecipeId } from "@/types";
import type { ProductionLineData } from "./components/ProductionTable";

export default function App() {
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
      console.log("Recalculated plan:", tableData);
    } catch (e) {
      error = e instanceof Error ? e.message : "计算错误";
    }

    return { plan, tableData, error };
  }, [targets, recipeOverrides]);

  const handleTargetChange = (index: number, rate: number) => {
    const newTargets = [...targets];
    newTargets[index].rate = rate;
    setTargets(newTargets);
  };

  const handleTargetRemove = (index: number) => {
    setTargets(targets.filter((_, i) => i !== index));
  };

  const handleAddTarget = (itemId: ItemId, rate: number) => {
    setTargets([...targets, { itemId, rate }]);
  };

  const handleRecipeChange = (itemId: ItemId, recipeId: RecipeId) => {
    setRecipeOverrides((prev) => {
      const newMap = new Map(prev);
      newMap.set(itemId, recipeId);
      return newMap;
    });
  };

  return (
    <div className="h-screen flex flex-col p-4 gap-4">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">工厂生产计算器</h1>
        <div className="text-sm text-muted-foreground">
          v2.0 | {new Date().toLocaleDateString()}
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* 左侧面板 */}
        <div className="w-[420px] flex flex-col gap-4 min-h-0">
          <Card className="flex-shrink-0">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">生产目标</CardTitle>
                <div className="text-xs text-muted-foreground">
                  {targets.length} / 12
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <TargetItemsGrid
                targets={targets}
                items={items}
                onTargetChange={handleTargetChange}
                onTargetRemove={handleTargetRemove}
                onAddClick={() => setDialogOpen(true)}
                language="zh-CN"
              />
            </CardContent>
          </Card>

          <Card className="flex-shrink-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">生产统计</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {error ? (
                <div className="flex items-center gap-2 text-destructive text-sm p-3 bg-destructive/10 rounded">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">
                        总功耗
                      </div>
                      <div className="text-lg font-bold">
                        {plan?.totalPowerConsumption.toFixed(1) || "0"}
                        <span className="text-xs font-normal text-muted-foreground ml-1">
                          kW
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">
                        生产步骤
                      </div>
                      <div className="text-lg font-bold">
                        {tableData.length}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">
                        原材料
                      </div>
                      <div className="text-lg font-bold">
                        {plan?.rawMaterialRequirements.size || 0}
                      </div>
                    </div>
                  </div>

                  <Separator />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧面板 */}
        <div className="flex-1 min-w-0">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 flex-shrink-0">
              <CardTitle className="text-base">生产线配置</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-auto">
              <ProductionTable
                data={tableData}
                items={items}
                facilities={facilities}
                onRecipeChange={handleRecipeChange}
                language="zh-CN"
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
        language="zh-CN"
      />
    </div>
  );
}
