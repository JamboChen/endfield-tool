import { useTranslation } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip";

import { items, facilities } from "./data";
import { useProductionPlan } from "./hooks/useProductionPlan";
import AppHeader from "./components/layout/AppHeader";
import LeftPanel from "./components/panels/LeftPanel";
import ProductionViewTabs from "./components/production/ProductionViewTabs";
import AddTargetDialogGrid from "./components/panels/AddTargetDialogGrid";
import AppFooter from "./components/layout/AppFooter";

export default function App() {
  const { i18n } = useTranslation("app");

  const {
    targets,
    dialogOpen,
    activeTab,
    plan,
    tableData,
    stats,
    error,
    handleTargetChange,
    handleTargetRemove,
    handleAddTarget,
    handleToggleRawMaterial,
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
      <div className="h-screen flex flex-col p-4 pb-0 gap-4">
        <AppHeader onLanguageChange={handleLanguageChange} />

        <div className="flex-1 flex gap-4 min-h-0">
          <LeftPanel
            targets={targets}
            items={items}
            totalPowerConsumption={stats.totalPowerConsumption}
            productionSteps={stats.uniqueProductionSteps}
            rawMaterialCount={stats.rawMaterialRequirements.size}
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
            onToggleRawMaterial={handleToggleRawMaterial}
          />
        </div>

        <AddTargetDialogGrid
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          items={items}
          existingTargetIds={targets.map((t) => t.itemId)}
          onAddTarget={handleAddTarget}
        />

        <AppFooter />
      </div>
    </TooltipProvider>
  );
}
