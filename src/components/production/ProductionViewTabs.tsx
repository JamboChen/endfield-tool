import { useTranslation } from "react-i18next";
import { useState } from "react";
import ProductionTable from "./ProductionTable";
import ProductionDependencyTree from "../flow/ProductionDependencyTree";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  ItemId,
  RecipeId,
  Item,
  Facility,
  ProductionDependencyGraph,
  VisualizationMode,
} from "@/types";
import type { ProductionLineData } from "./ProductionTable";

interface ProductionViewTabsProps {
  plan: ProductionDependencyGraph | null;
  tableData: ProductionLineData[];
  items: Item[];
  facilities: Facility[];
  activeTab: "table" | "tree";
  onTabChange: (tab: "table" | "tree") => void;
  onRecipeChange: (itemId: ItemId, recipeId: RecipeId) => void;
  onToggleRawMaterial: (itemId: ItemId) => void;
}

export default function ProductionViewTabs({
  plan,
  tableData,
  items,
  facilities,
  activeTab,
  onTabChange,
  onRecipeChange,
  onToggleRawMaterial,
}: ProductionViewTabsProps) {
  const { t } = useTranslation("app");
  const [visualizationMode, setVisualizationMode] =
    useState<VisualizationMode>("merged");

  return (
    <div className="flex-1 min-w-0">
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <Tabs
              value={activeTab}
              onValueChange={(val) => onTabChange(val as "table" | "tree")}
              className="flex-1"
            >
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="table" className="gap-2">
                  <span className="text-base">📊</span>
                  <span>{t("tabs.table")}</span>
                </TabsTrigger>
                <TabsTrigger value="tree" className="gap-2">
                  <span className="text-base">🌳</span>
                  <span>{t("tabs.tree")}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {activeTab === "tree" && (
              <ToggleGroup
                type="single"
                value={visualizationMode}
                onValueChange={(value) => {
                  if (value) setVisualizationMode(value as VisualizationMode);
                }}
              >
                <ToggleGroupItem value="merged" aria-label="Merged view">
                  <span className="text-xs">{t("tabs.merged")}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="separated" aria-label="Separated view">
                  <span className="text-xs">{t("tabs.separated")}</span>
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-hidden p-0">
          <Tabs value={activeTab} className="h-full">
            <TabsContent value="table" className="h-full m-0 p-4 pt-0">
              <div className="h-full overflow-auto">
                <ProductionTable
                  data={tableData}
                  items={items}
                  facilities={facilities}
                  onRecipeChange={onRecipeChange}
                  onToggleRawMaterial={onToggleRawMaterial}
                />
              </div>
            </TabsContent>
            <TabsContent value="tree" className="h-full m-0">
              <ProductionDependencyTree
                plan={plan}
                items={items}
                facilities={facilities}
                visualizationMode={visualizationMode}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
