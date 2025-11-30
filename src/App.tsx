import { useTranslation } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip";

import { items, facilities } from "./data";
import { useProductionPlan } from "./hooks/useProductionPlan";
import AppHeader from "./components/AppHeader";
import LeftPanel from "./components/LeftPanel";
import ProductionViewTabs from "./components/ProductionViewTabs";
import AddTargetDialogGrid from "./components/AddTargetDialogGrid";

export default function App() {
  const { i18n } = useTranslation("app");

  const {
    targets,
    dialogOpen,
    activeTab,
    plan,
    tableData,
    error,
    handleTargetChange,
    handleTargetRemove,
    handleAddTarget,
    handleRecipeChange,
    handleAddClick,
    setDialogOpen,
    setActiveTab,
  } = useProductionPlan();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col p-4 gap-4">
        <AppHeader onLanguageChange={handleLanguageChange} />

        <div className="flex-1 flex gap-4 min-h-0">
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

          <ProductionViewTabs
            plan={plan}
            tableData={tableData}
            items={items}
            facilities={facilities}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onRecipeChange={handleRecipeChange}
          />
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
