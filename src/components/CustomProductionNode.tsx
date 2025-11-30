import { Handle, type NodeProps, type Node, Position } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ItemIcon } from "./ProductionTable";
import { RecipeIOFull } from "./ProductionTable";
import { getItemName, getFacilityName } from "@/lib/i18n-helpers";
import { useTranslation } from "react-i18next";
import type { Item, Facility } from "@/types";
import type { ProductionNode } from "@/lib/calculator";

/**
 * Interface for the data expected by the CustomProductionNode.
 */
export interface FlowNodeData {
  productionNode: ProductionNode;
  isCircular: boolean;
  items: Item[];
  facilities: Facility[];
  [key: string]: unknown;
}

export type FlowProductionNode = Node<FlowNodeData>;
/**
 * Formats a number to a fixed number of decimal places.
 * @param num The number to format.
 * @param decimals The number of decimal places. Defaults to 2.
 * @returns The formatted number as a string.
 */
const formatNumber = (num: number, decimals = 2): string => {
  return num.toFixed(decimals);
};

/**
 * CustomProductionNode component renders a single production node in the dependency tree.
 * It displays item information, production rate, facility details, and highlights circular dependencies.
 * @param {NodeProps<FlowNodeData>} props The properties for the custom node.
 * @returns A React component representing a production node.
 */
export default function CustomProductionNode({
  data,
  sourcePosition = Position.Right, // Default source handle position
  targetPosition = Position.Left, // Default target handle position
}: NodeProps<FlowProductionNode>) {
  const { productionNode: node, isCircular, items } = data;
  const { t } = useTranslation("production");

  /**
   * Helper function to find an item by its ID from the provided items array.
   * @param itemId The ID of the item to find.
   * @returns The Item object or undefined if not found.
   */
  const getItemById = (itemId: string) => items.find((i) => i.id === itemId);

  const itemName = getItemName(node.item);
  const facility = node.facility;
  const facilityName = facility ? getFacilityName(facility) : "";

  // Adjust border colors based on node type for better visual distinction
  let borderColor = "border-gray-300 dark:border-gray-600";
  if (!node.isRawMaterial && node.recipe) {
    // Blue border for production nodes, red for circular dependencies
    borderColor = isCircular
      ? "border-red-500"
      : "border-blue-600 dark:border-blue-400";
  } else if (node.isRawMaterial) {
    // Green border for raw material nodes
    borderColor = "border-green-600 dark:border-green-400";
  }

  // Tooltip content for detailed node information
  const tooltipContent = (
    <div className="text-xs max-w-[300px] p-2 max-h-[80vh] overflow-y-auto">
      <div className="font-bold mb-1">
        {t("tree.item")}: {itemName}
      </div>
      {node.isRawMaterial ? (
        <p className="text-muted-foreground">
          {isCircular
            ? t("tree.circularRawMaterial")
            : t("tree.trueRawMaterial")}
        </p>
      ) : node.recipe ? (
        <>
          <RecipeIOFull recipe={node.recipe} getItemById={getItemById} />
          {facility && (
            <div className="mt-2 pt-2 border-t">
              <div className="text-muted-foreground">
                {t("tree.facility")}: {facilityName}
              </div>
              <div className="text-muted-foreground">
                {t("tree.power")}: {facility.powerConsumption} MW ×{" "}
                {formatNumber(node.facilityCount, 1)} ={" "}
                {formatNumber(
                  facility.powerConsumption * node.facilityCount,
                  1,
                )}{" "}
                MW
              </div>
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card
          className={`w-52 shadow-lg ${borderColor} border-2 hover:shadow-xl transition-shadow cursor-help relative`}
        >
          {/* Target handle for incoming connections */}
          <Handle
            type="target"
            position={targetPosition as Position}
            isConnectable={false} // Not connectable by user interaction
          />
          <CardContent className="p-3 text-xs">
            {/* Item icon and name */}
            <div className="flex items-center gap-2 mb-2">
              <ItemIcon item={node.item} />
              <span className="font-bold truncate flex-1">{itemName}</span>
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
                    <span className="text-sm">🏭</span> // Fallback icon
                  )}
                  <span className="text-[10px] text-muted-foreground truncate max-w-20">
                    {facilityName}
                  </span>
                </div>
                <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">
                  ×{formatNumber(node.facilityCount, 1)}
                </span>
              </div>
            )}
            {/* Circular dependency warning */}
            {isCircular && (
              <div className={circularWarningClasses}>
                ⚠️ {t("tree.circularWarning")}
              </div>
            )}
          </CardContent>
          {/* Source handle for outgoing connections */}
          <Handle
            type="source"
            position={sourcePosition as Position}
            isConnectable={false} // Not connectable by user interaction
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
