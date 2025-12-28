import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ItemIcon } from "../ProductionTable";
import { getItemName } from "@/lib/i18n-helpers";
import { useTranslation } from "react-i18next";
import type { CycleNodeData } from "../flow-mapping/types";

const formatNumber = (num: number, decimals = 2): string => {
  return num.toFixed(decimals);
};

/**
 * CustomCycleNode component renders a collapsed cycle as a single node.
 * Shows the net outputs of the cycle and aggregated facility/power info.
 */
export default function CustomCycleNode({
  data,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
}: NodeProps<Node<CycleNodeData>>) {
  const { cycle, items, totalFacilityCount, totalPowerConsumption } = data;
  const { t } = useTranslation("production");

  // Get item objects for all items in the cycle
  const cycleItems = cycle.involvedItemIds
    .map((itemId) => items.find((i) => i.id === itemId))
    .filter((item): item is import("@/types").Item => item !== undefined);

  // Get the primary output (usually the first item with positive net output)
  const primaryOutputEntry = Array.from(cycle.netOutputs.entries())[0];
  const primaryOutputId = primaryOutputEntry?.[0];
  const primaryOutputRate = primaryOutputEntry?.[1] || 0;
  const primaryOutputItem = items.find((i) => i.id === primaryOutputId);

  // Generate cycle display name
  const cycleName = cycleItems
    .slice(0, 2)
    .map((item) => getItemName(item))
    .join("-");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card className="w-60 shadow-lg border-2 border-purple-500 bg-linear-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-900/30 hover:shadow-xl transition-shadow cursor-help">
          <Handle
            type="target"
            position={targetPosition}
            isConnectable={false}
            className="bg-purple-500!"
          />
          <CardContent className="p-3 text-xs">
            {/* Cycle header */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🔄</span>
              <div className="flex-1">
                <div className="font-bold text-sm text-purple-700 dark:text-purple-300">
                  {cycleName}
                </div>
                <div className="text-[10px] text-purple-600 dark:text-purple-400">
                  {t("tree.cyclicProduction")}
                </div>
              </div>
            </div>

            {/* Cycle items preview */}
            <div className="flex items-center gap-1 mb-2 flex-wrap">
              {cycleItems.slice(0, 4).map((item) => (
                <ItemIcon key={item.id} item={item} />
              ))}
              {cycleItems.length > 4 && (
                <span className="text-[10px] text-muted-foreground">
                  +{cycleItems.length - 4}
                </span>
              )}
            </div>

            {/* Net output */}
            {primaryOutputItem && (
              <div className="flex items-center justify-between bg-purple-100/70 dark:bg-purple-900/50 rounded px-2 py-1 mb-2">
                <div className="flex items-center gap-1">
                  <ItemIcon item={primaryOutputItem} />
                  <span className="text-[10px] text-muted-foreground">
                    {t("tree.netOutput")}
                  </span>
                </div>
                <span className="font-mono font-semibold text-purple-700 dark:text-purple-300">
                  {formatNumber(Math.abs(primaryOutputRate))} /min
                </span>
              </div>
            )}

            {/* Facility summary */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>{t("tree.totalFacilities")}</span>
              <span className="font-mono">
                {formatNumber(totalFacilityCount, 1)}
              </span>
            </div>

            {/* Power summary */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{t("tree.totalPower")}</span>
              <span className="font-mono">
                {formatNumber(totalPowerConsumption, 0)} MW
              </span>
            </div>

            {/* Expand hint */}
            <div className="mt-2 text-center text-[9px] text-purple-600 dark:text-purple-400 italic">
              {t("tree.clickToExpand")}
            </div>
          </CardContent>
          <Handle
            type="source"
            position={sourcePosition}
            isConnectable={false}
            className="bg-purple-500!"
          />
        </Card>
      </TooltipTrigger>

      {/* Detailed tooltip */}
      <TooltipContent
        side="right"
        className="p-0 border shadow-md max-w-[400px]"
      >
        <div className="text-xs p-3">
          <div className="font-bold mb-2 text-purple-700 dark:text-purple-300">
            🔄 {cycleName} {t("tree.cycle")}
          </div>

          {/* Cycle path */}
          <div className="mb-2">
            <div className="text-[10px] text-muted-foreground mb-1">
              {t("tree.cyclePath")}:
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {cycleItems.map((item, index) => (
                <div key={item.id} className="flex items-center gap-1">
                  <ItemIcon item={item} />
                  <span className="text-[10px]">{getItemName(item)}</span>
                  {index < cycleItems.length - 1 && (
                    <span className="text-muted-foreground">→</span>
                  )}
                </div>
              ))}
              <span className="text-muted-foreground">↻</span>
            </div>
          </div>

          {/* Net outputs */}
          <div className="mb-2">
            <div className="text-[10px] text-muted-foreground mb-1">
              {t("tree.netOutputs")}:
            </div>
            {Array.from(cycle.netOutputs.entries()).map(([itemId, rate]) => {
              const item = items.find((i) => i.id === itemId);
              if (!item) return null;
              return (
                <div
                  key={itemId}
                  className="flex items-center justify-between text-[10px] mb-1"
                >
                  <div className="flex items-center gap-1">
                    <ItemIcon item={item} />
                    <span>{getItemName(item)}</span>
                  </div>
                  <span className="font-mono">
                    {rate > 0 ? "+" : ""}
                    {formatNumber(rate)} /min
                  </span>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="pt-2 border-t">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{t("tree.facilities")}:</span>
              <span>{formatNumber(totalFacilityCount, 1)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{t("tree.power")}:</span>
              <span>{formatNumber(totalPowerConsumption, 0)} MW</span>
            </div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
