import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

type ProductionStatsProps = {
  totalPowerConsumption: number;
  productionSteps: number;
  rawMaterialCount: number;
  error: string | null;
};

const ProductionStats = memo(function ProductionStats({
  totalPowerConsumption,
  productionSteps,
  rawMaterialCount,
  error,
}: ProductionStatsProps) {
  const { t } = useTranslation("stats");
  return (
    <Card className="shrink-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <div className="flex items-center gap-2 text-destructive text-sm p-3 bg-destructive/10 rounded">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  {t("totalPower")}
                </div>
                <div className="text-lg font-bold">
                  {totalPowerConsumption.toFixed(1)}
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    {t("powerUnit")}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  {t("productionSteps")}
                </div>
                <div className="text-lg font-bold">{productionSteps}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  {t("rawMaterials")}
                </div>
                <div className="text-lg font-bold">{rawMaterialCount}</div>
              </div>
            </div>

            <Separator />
          </>
        )}
      </CardContent>
    </Card>
  );
});

export default ProductionStats;
