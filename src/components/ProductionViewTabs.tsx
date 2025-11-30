import { useTranslation } from "react-i18next";
import ProductionTable from "./ProductionTable";
import ProductionDependencyTree from "./ProductionDependencyTree";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UnifiedProductionPlan } from "../lib/calculator";
import type { Item, Facility } from "@/types";
import type { ProductionLineData } from "./ProductionTable";
import type { ItemId, RecipeId } from "@/types";

interface ProductionViewTabsProps {
  plan: UnifiedProductionPlan | null;
  tableData: ProductionLineData[];
  items: Item[];
  facilities: Facility[];
  activeTab: "table" | "tree";
  onTabChange: (tab: "table" | "tree") => void;
  onRecipeChange: (itemId: ItemId, recipeId: RecipeId) => void;
}

export default function ProductionViewTabs({
  plan,
  tableData,
  items,
  facilities,
  activeTab,
  onTabChange,
  onRecipeChange,
}: ProductionViewTabsProps) {
  const { t } = useTranslation("app");

  return (
    <div className="flex-1 min-w-0">
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3 shrink-0">
          <Tabs
            value={activeTab}
            onValueChange={(val) => onTabChange(val as "table" | "tree")} // Corrected prop name
            className="w-full"
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
                />
              </div>
            </TabsContent>
            <TabsContent value="tree" className="h-full m-0">
              <ProductionDependencyTree
                plan={plan}
                items={items}
                facilities={facilities}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
