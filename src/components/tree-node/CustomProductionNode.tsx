import { Handle, type NodeProps, type Node, Position } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ItemIcon } from "../ProductionTable";
import { RecipeIOFull } from "../ProductionTable";
import { getItemName, getFacilityName } from "@/lib/i18n-helpers";
import { useTranslation } from "react-i18next";
import type {
  FlowNodeData,
  FlowNodeDataSeparated,
  FlowNodeDataSeparatedWithTarget,
  FlowNodeDataWithTarget,
} from "../flow-mapping/types";

/**
 * Type alias for a React Flow node containing production data.
 * Can be either base FlowNodeData (merged mode) or FlowNodeDataSeparated (separated mode).
 */
export type FlowProductionNode = Node<FlowNodeData | FlowNodeDataSeparated>;

/**
 * Formats a number to a fixed number of decimal places.
 *
 * @param num The number to format
 * @param decimals The number of decimal places. Defaults to 2
 * @returns The formatted number as a string
 */
const formatNumber = (num: number, decimals = 2): string => {
  return num.toFixed(decimals);
};

/**
 * Type guard to check if node data is from separated mode.
 *
 * @param data The node data to check
 * @returns True if the data includes separated mode fields
 */
function isSeparatedMode(
  data: FlowNodeData | FlowNodeDataSeparated,
): data is FlowNodeDataSeparated {
  return "facilityIndex" in data && data.facilityIndex !== undefined;
}

function hasTargetInfo(
  data: FlowNodeData | FlowNodeDataSeparated,
): data is FlowNodeDataWithTarget | FlowNodeDataSeparatedWithTarget {
  return "isDirectTarget" in data && data.isDirectTarget === true;
}

/**
 * CustomProductionNode component renders a single production node in the dependency tree.
 *
 * The component adapts its display based on the visualization mode:
 * - Merged mode: Shows aggregated facility counts (e.g., "×2.5")
 * - Separated mode: Shows individual facility index (e.g., "1/3") and partial load status
 *
 * It displays item information, production rate, facility details, and highlights
 * circular dependencies and partial load conditions.
 *
 * @param {NodeProps<FlowProductionNode>} props The properties for the custom node
 * @returns A React component representing a production node
 */
export default function CustomProductionNode({
  data,
}: NodeProps<FlowProductionNode>) {
  const { productionNode: node, isCircular, items, cycleInfo } = data;
  const { t } = useTranslation("production");

  /**
   * Helper function to find an item by its ID from the provided items array.
   *
   * @param itemId The ID of the item to find
   * @returns The Item object or undefined if not found
   */
  const getItemById = (itemId: string) => items.find((i) => i.id === itemId);

  const itemName = getItemName(node.item);
  const facility = node.facility;
  const facilityName = facility ? getFacilityName(facility) : "";

  // Check if this is separated mode data
  const isSeparated = isSeparatedMode(data);
  const isTarget = hasTargetInfo(data);
  const targetRate = isTarget ? data.directTargetRate : undefined;

  // Adjust border colors based on node type for better visual distinction
  let borderColor = "border-gray-300 dark:border-gray-600";
  // Cycle nodes get purple border
  if (cycleInfo?.isPartOfCycle) {
    borderColor = cycleInfo.isBreakPoint
      ? "border-purple-500 border-dashed" // Dashed for break point
      : "border-purple-400"; // Solid for other cycle members
  } else if (!node.isRawMaterial && node.recipe) {
    // Regular production nodes get blue border
    borderColor = "border-blue-600 dark:border-blue-400";
  } else if (node.isRawMaterial) {
    // Raw materials get green border
    borderColor = "border-green-600 dark:border-green-400";
  }

  // Tooltip content for detailed node information
  const tooltipContent = (
    <div className="text-xs max-w-[300px] p-2 max-h-[80vh] overflow-y-auto">
      <div className="font-bold mb-1">
        {t("tree.item")}: {itemName}
      </div>
      {node.isRawMaterial ? (
        <div>
          {cycleInfo?.isPartOfCycle ? (
            <div>
              <p className="text-purple-600 dark:text-purple-400 font-medium mb-1">
                🔄 {t("tree.partOfCycle")}
              </p>
              <p className="text-muted-foreground text-xs">
                {cycleInfo.isBreakPoint
                  ? t("tree.cycleBreakPointDesc")
                  : t("tree.cycleMemberDesc")}
              </p>
              {cycleInfo.cycleDisplayName && (
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                  {cycleInfo.cycleDisplayName}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              {isCircular
                ? t("tree.circularRawMaterial")
                : t("tree.trueRawMaterial")}
            </p>
          )}
        </div>
      ) : node.recipe ? (
        <>
          <RecipeIOFull recipe={node.recipe} getItemById={getItemById} />
          {facility && (
            <div className="mt-2 pt-2 border-t">
              <div className="text-muted-foreground">
                {t("tree.facility")}: {facilityName}
              </div>
              {isSeparated ? (
                // Separated mode: show individual facility info
                <>
                  <div className="text-muted-foreground">
                    {t("tree.facilityIndex")}: {data.facilityIndex! + 1} /{" "}
                    {data.totalFacilities}
                  </div>
                  <div className="text-muted-foreground">
                    {t("tree.power")}: {facility.powerConsumption} MW
                  </div>
                  {data.isPartialLoad && (
                    <div className="text-yellow-600 dark:text-yellow-400 text-xs mt-1">
                      ⚡ {t("tree.partialLoad")}
                    </div>
                  )}
                </>
              ) : (
                // Merged mode: show total power
                <div className="text-muted-foreground">
                  {t("tree.power")}: {facility.powerConsumption} MW ×{" "}
                  {formatNumber(node.facilityCount, 1)} ={" "}
                  {formatNumber(
                    facility.powerConsumption * node.facilityCount,
                    1,
                  )}{" "}
                  MW
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );

  // CSS classes for facility block and circular warning for consistent styling
  const facilityBlockClasses =
    "flex items-center justify-between bg-blue-100/70 dark:bg-blue-900/50 rounded-lg px-2 py-1 transition-colors";
  const circularWarningClasses =
    "text-red-600 dark:text-red-400 font-medium text-[10px] mt-2 text-center py-0.5 rounded bg-red-100/70 dark:bg-red-900/30";
  const partialLoadClasses =
    "text-yellow-600 dark:text-yellow-400 font-medium text-[10px] mt-1 text-center py-0.5 rounded bg-yellow-100/70 dark:bg-yellow-900/30";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card
          className={`w-52 shadow-lg ${borderColor} border-2 hover:shadow-xl transition-shadow cursor-help relative`}
        >
          {/* Multiple target handles for different directions */}
          <Handle
            type="target"
            position={Position.Left}
            id="left"
            isConnectable={false}
            className="w-3! h-3!"
          />
          <Handle
            type="target"
            position={Position.Top}
            id="top"
            isConnectable={false}
            className="w-3! h-3!"
          />
          <Handle
            type="target"
            position={Position.Right}
            id="right"
            isConnectable={false}
            className="w-3! h-3! opacity-30!"
            style={{ pointerEvents: "none" }}
          />
          <Handle
            type="target"
            position={Position.Bottom}
            id="bottom"
            isConnectable={false}
            className="w-3! h-3! opacity-30!"
            style={{ pointerEvents: "none" }}
          />
          <CardContent className="p-3 text-xs">
            {/* Item icon and name */}
            <div className="flex items-center gap-2 mb-2 relative">
              <ItemIcon item={node.item} />
              <span className="font-bold truncate flex-1">
                {itemName}
                {/* Show facility index in separated mode */}
                {isSeparated && data.facilityIndex !== undefined && (
                  <span className="text-muted-foreground ml-1 text-[10px]">
                    #{data.facilityIndex + 1}
                  </span>
                )}
              </span>
              {/* Target badge for nodes that are also direct targets */}
              {isTarget && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="absolute -top-1 -right-1 bg-amber-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md">
                      ⭐
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">
                      {t("tree.alsoTarget")}: {formatNumber(targetRate!)} /min
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {/* Production/Requirement rate */}
            <div className="flex items-center justify-between mb-2 bg-muted/50 rounded px-2 py-1">
              <span className="text-muted-foreground text-[10px]">
                {node.isRawMaterial ? t("tree.required") : t("tree.produced")}
              </span>
              <span className="font-mono font-semibold">
                {formatNumber(node.targetRate)} /min
              </span>
            </div>
            {/* Facility details for non-raw material nodes */}
            {!node.isRawMaterial && facility && (
              <div className={facilityBlockClasses}>
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
                  {isSeparated
                    ? // Separated mode: show facility index out of total
                      `${data.facilityIndex! + 1}/${data.totalFacilities}`
                    : // Merged mode: show facility count
                      `×${formatNumber(node.facilityCount, 1)}`}
                </span>
              </div>
            )}
            {/* Partial load indicator (separated mode only) */}
            {isSeparated && data.isPartialLoad && (
              <div className={partialLoadClasses}>
                ⚡ {t("tree.partialLoad")}
              </div>
            )}
            {/* Cycle indicator - replaces the old circular warning */}
            {cycleInfo?.isPartOfCycle && (
              <div className="mt-2 bg-purple-100/70 dark:bg-purple-900/50 rounded px-2 py-1">
                <div className="flex items-center justify-center gap-1 text-purple-700 dark:text-purple-300 text-[10px] font-medium">
                  <span>🔄</span>
                  <span>
                    {cycleInfo.isBreakPoint
                      ? t("tree.cycleBreakPoint")
                      : t("tree.cycleMember")}
                  </span>
                </div>
                {cycleInfo.cycleDisplayName && (
                  <div className="text-center text-[9px] text-purple-600 dark:text-purple-400 mt-0.5">
                    {cycleInfo.cycleDisplayName}
                  </div>
                )}
              </div>
            )}
            {/* Keep old circular warning only for non-cycle circular dependencies (if any) */}
            {isCircular && !cycleInfo?.isPartOfCycle && (
              <div className={circularWarningClasses}>
                ⚠️ {t("tree.circularWarning")}
              </div>
            )}
            {/* Circular dependency warning */}
            {isCircular && (
              <div className={circularWarningClasses}>
                ⚠️ {t("tree.circularWarning")}
              </div>
            )}
          </CardContent>
          {/* Multiple source handles for different directions */}
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            isConnectable={false}
            className="w-3! h-3!"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="bottom"
            isConnectable={false}
            className="w-3! h-3!"
          />
          <Handle
            type="source"
            position={Position.Left}
            id="left"
            isConnectable={false}
            className="w-3! h-3! opacity-30!"
            style={{ pointerEvents: "none" }}
          />
          <Handle
            type="source"
            position={Position.Top}
            id="top"
            isConnectable={false}
            className="w-3! h-3! opacity-30!"
            style={{ pointerEvents: "none" }}
          />
        </Card>
      </TooltipTrigger>
      {/* Tooltip content with detailed information */}
      <TooltipContent side="right" className="p-0 border shadow-md">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}
