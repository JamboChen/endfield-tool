import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ItemIcon } from "../production/ProductionTable";
import { getItemName, getFacilityName } from "@/lib/i18n-helpers";
import { useTranslation } from "react-i18next";
import type { TargetSinkNodeData } from "@/types";

/**
 * Formats a number to a fixed number of decimal places.
 */
const formatNumber = (num: number, decimals = 2): string => {
  return num.toFixed(decimals);
};

/**
 * CustomTargetNode component renders a virtual sink node representing a user-defined production target.
 *
 * For terminal targets (targets without downstream consumers), it also displays production information
 * including facility count and recipe details.
 */
export default function CustomTargetNode({
  data,
  targetPosition = Position.Left,
}: NodeProps<Node<TargetSinkNodeData>>) {
  const { item, targetRate, productionInfo } = data;
  const { t } = useTranslation("production");
  const itemName = getItemName(item);

  // Check if this is a terminal target with production info
  const isTerminalTarget = productionInfo !== undefined;
  const facility = productionInfo?.facility;
  const facilityName = facility ? getFacilityName(facility) : "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card
          className="
            w-52 h-full shadow-xl
            border-4 border-amber-500 dark:border-amber-400
            bg-linear-to-br from-amber-50 to-green-50 dark:from-amber-950/30 dark:to-green-950/30
            hover:shadow-2xl transition-shadow cursor-help relative
          "
        >
          {/* Target handle for incoming connections */}
          <Handle
            type="target"
            position={targetPosition}
            isConnectable={false}
            className="bg-amber-500!"
          />
          <CardContent className="p-3 text-xs">
            {/* Target indicator and item info */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🎯</span>
              <ItemIcon item={item} />
              <span className="font-bold truncate flex-1">{itemName}</span>
            </div>

            {/* Target label */}
            <div className="text-center mb-2">
              <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold uppercase tracking-wide">
                {t("tree.target")}
              </span>
            </div>

            {/* Target rate */}
            <div className="flex items-center justify-between bg-amber-100/70 dark:bg-amber-900/50 rounded px-2 py-1 mb-2">
              <span className="text-muted-foreground text-[10px]">
                {t("tree.targetRate")}
              </span>
              <span className="font-mono font-semibold text-amber-700 dark:text-amber-300">
                {formatNumber(targetRate)} /min
              </span>
            </div>

            {/* Production info for terminal targets */}
            {isTerminalTarget && facility && (
              <div className="flex items-center justify-between bg-blue-100/70 dark:bg-blue-900/50 rounded-lg px-2 py-1">
                <div className="flex items-center gap-1.5">
                  {facility.iconUrl ? (
                    <img
                      src={facility.iconUrl}
                      alt={facilityName}
                      className="h-5 w-5 object-contain"
                    />
                  ) : (
                    <span className="text-sm">🏭</span>
                  )}
                  <span className="text-[10px] text-muted-foreground truncate max-w-20">
                    {facilityName}
                  </span>
                </div>
                <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">
                  ×{formatNumber(productionInfo.facilityCount, 1)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </TooltipTrigger>

      {/* Tooltip content */}
      <TooltipContent side="right" className="p-2 border shadow-md">
        <div className="text-xs max-w-[200px]">
          <div className="font-bold mb-1">{t("tree.productionTarget")}</div>
          <div className="text-muted-foreground">
            {t("tree.targetDescription", {
              item: itemName,
              rate: formatNumber(targetRate),
            })}
          </div>

          {/* Show production details for terminal targets */}
          {isTerminalTarget && facility && productionInfo.recipe && (
            <div className="mt-2 pt-2 border-t">
              <div className="text-muted-foreground">
                {t("tree.facility")}: {facilityName}
              </div>
              <div className="text-muted-foreground">
                {t("tree.facilityCount")}:{" "}
                {formatNumber(productionInfo.facilityCount, 1)}
              </div>
              <div className="text-muted-foreground">
                {t("tree.power")}:{" "}
                {formatNumber(
                  facility.powerConsumption * productionInfo.facilityCount,
                  1,
                )}{" "}
                MW
              </div>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
