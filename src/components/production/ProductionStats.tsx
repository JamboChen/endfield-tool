import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Facility } from "@/types";
import { getFacilityName } from "@/lib/i18n-helpers";

type ProductionStatsProps = {
  totalPowerConsumption: number;
  productionSteps: number;
  rawMaterialCount: number;
  facilityRequirements: Map<string, number>;
  facilities: Facility[];
  error: string | null;
};

const ProductionStats = memo(function ProductionStats({
  totalPowerConsumption,
  productionSteps,
  rawMaterialCount,
  facilityRequirements,
  facilities,
  error,
}: ProductionStatsProps) {
  const { t } = useTranslation("stats");

  const facilityList = Array.from(facilityRequirements.entries())
    .map(([facilityId, count]) => {
      const facility = facilities.find((f) => f.id === facilityId);
      return facility ? { facility, count } : null;
    })
    .filter(
      (item): item is { facility: Facility; count: number } => item !== null,
    )
    .sort((a, b) => a.facility.id.localeCompare(b.facility.id));

  return (
    <Card className="shrink-0 border-border/50">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
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
                <div className="text-lg font-bold font-mono">
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
                <div className="text-lg font-bold font-mono">
                  {productionSteps}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  {t("rawMaterials")}
                </div>
                <div className="text-lg font-bold font-mono">
                  {rawMaterialCount}
                </div>
              </div>
            </div>

            {facilityList.length > 0 && (
              <>
                <Separator />
                <div className="grid grid-cols-2 gap-2">
                  {facilityList.map(({ facility, count }) => (
                    <div
                      key={facility.id}
                      className="space-y-0.5 p-2 border border-border/50 bg-card"
                    >
                      <div className="flex items-center gap-1.5">
                        {facility.iconUrl && (
                          <img
                            src={facility.iconUrl}
                            alt={getFacilityName(facility)}
                            className="w-4 h-4 object-contain"
                          />
                        )}
                        <div className="text-xs text-muted-foreground truncate flex-1">
                          {getFacilityName(facility)}
                        </div>
                      </div>
                      <div className="text-sm font-semibold font-mono">
                        {count.toFixed(1)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
});

export default ProductionStats;
