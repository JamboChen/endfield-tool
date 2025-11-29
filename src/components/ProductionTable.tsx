import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Item, Recipe, Facility, ItemId, RecipeId } from "@/types";

export type ProductionLineData = {
  item: Item;
  outputRate: number;
  availableRecipes: Recipe[];
  selectedRecipeId: RecipeId | "";
  facility: Facility | null;
  facilityCount: number;
  isRawMaterial?: boolean;
};

type ProductionTableProps = {
  data: ProductionLineData[];
  items: Item[];
  facilities: Facility[];
  onRecipeChange: (itemId: ItemId, recipeId: RecipeId) => void;
  language?: "en" | "zh-CN" | "zh-TW";
};

export default function ProductionTable({
  data,
  items,
  onRecipeChange,
  language = "zh-CN",
}: ProductionTableProps) {
  const getItemName = (item: Item) => {
    return item.name[language] || item.name.en || item.id;
  };

  const getItemById = (itemId: ItemId): Item | undefined => {
    return items.find((item) => item.id === itemId);
  };

  const getFacilityName = (facility: Facility) => {
    return facility.name[language] || facility.name.en || facility.id;
  };

  const formatNumber = (num: number, decimals = 2) => num.toFixed(decimals);

  const renderRecipeIOCompact = (recipe: Recipe) => {
    const maxDisplay = 2;

    const renderItems = (
      recipeItems: Array<{ itemId: ItemId; amount: number }>,
      max: number,
    ) => {
      const displayed = recipeItems.slice(0, max);
      const remaining = recipeItems.length - max;

      return (
        <>
          {displayed.map((ri, idx) => {
            const item = getItemById(ri.itemId);
            return (
              <span
                key={ri.itemId}
                className="inline-flex items-center gap-0.5"
              >
                {item?.iconUrl ? (
                  <img
                    src={item.iconUrl}
                    alt={item ? getItemName(item) : ri.itemId}
                    className="h-4 w-4 object-contain inline-block"
                  />
                ) : (
                  <span className="inline-block w-4 h-4 bg-muted rounded text-[8px] text-center leading-4">
                    ?
                  </span>
                )}
                <span className="text-[11px]">×{ri.amount}</span>
                {idx < displayed.length - 1 && (
                  <span className="text-muted-foreground mx-0.5">+</span>
                )}
              </span>
            );
          })}
          {remaining > 0 && (
            <span className="text-[11px] text-muted-foreground ml-0.5">
              +{remaining}
            </span>
          )}
        </>
      );
    };

    return (
      <div className="flex items-center gap-1 text-xs flex-wrap">
        {renderItems(recipe.inputs, maxDisplay)}
        <span className="text-muted-foreground mx-1">→</span>
        {renderItems(recipe.outputs, maxDisplay)}
        <span className="text-[10px] text-muted-foreground ml-1">
          ({recipe.craftingTime}s)
        </span>
      </div>
    );
  };

  const renderRecipeIOFull = (recipe: Recipe) => {
    const renderItems = (
      recipeItems: Array<{ itemId: ItemId; amount: number }>,
    ) => {
      return recipeItems.map((ri, idx) => {
        const item = getItemById(ri.itemId);
        const itemName = item ? getItemName(item) : ri.itemId;
        return (
          <span key={ri.itemId} className="inline-flex items-center gap-1">
            {item?.iconUrl && (
              <img
                src={item.iconUrl}
                alt={itemName}
                className="h-4 w-4 object-contain inline-block"
              />
            )}
            <span>
              {itemName} ×{ri.amount}
            </span>
            {idx < recipeItems.length - 1 && (
              <span className="text-muted-foreground mx-1">+</span>
            )}
          </span>
        );
      });
    };

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-muted-foreground text-xs">输入:</span>
          {renderItems(recipe.inputs)}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-muted-foreground text-xs">输出:</span>
          {renderItems(recipe.outputs)}
        </div>
        <div className="text-xs text-muted-foreground">
          时间: {recipe.craftingTime}s
        </div>
      </div>
    );
  };

  return (
    <TooltipProvider>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[50px] h-9">图标</TableHead>
              <TableHead className="h-9">物品</TableHead>
              <TableHead className="text-right h-9 w-[90px]">产能/分</TableHead>
              <TableHead className="h-9 min-w-[300px]">配方</TableHead>
              <TableHead className="h-9 w-[60px] text-center">设施</TableHead>
              <TableHead className="text-right h-9 w-[70px]">数量</TableHead>
              <TableHead className="text-right h-9 w-[80px]">
                功耗(kW)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground h-32"
                >
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              data.map((line) => {
                const selectedRecipe = line.availableRecipes.find(
                  (r) => r.id === line.selectedRecipeId,
                );
                const totalPower = line.facility?.powerConsumption
                  ? line.facility.powerConsumption * line.facilityCount
                  : 0;

                return (
                  <TableRow key={line.item.id} className="h-12">
                    {/* 图标 */}
                    <TableCell className="p-2">
                      {line.item.iconUrl ? (
                        <img
                          src={line.item.iconUrl}
                          alt={getItemName(line.item)}
                          className="h-8 w-8 object-contain"
                        />
                      ) : (
                        <div className="h-8 w-8 bg-muted rounded flex items-center justify-center">
                          <span className="text-[10px]">📦</span>
                        </div>
                      )}
                    </TableCell>

                    {/* 物品名称 */}
                    <TableCell className="font-medium text-sm p-2">
                      {getItemName(line.item)}
                    </TableCell>

                    {/* 产能 */}
                    <TableCell className="text-right font-mono text-sm p-2">
                      {formatNumber(line.outputRate)}
                    </TableCell>

                    {/* 配方 */}
                    <TableCell className="p-2">
                      {line.isRawMaterial ? (
                        <div className="text-xs text-muted-foreground">
                          原材料
                        </div>
                      ) : line.availableRecipes.length > 1 ? (
                        <Select
                          value={line.selectedRecipeId}
                          onValueChange={(value: RecipeId) =>
                            onRecipeChange(line.item.id, value)
                          }
                        >
                          <SelectTrigger className="h-auto min-h-[32px] text-xs py-1">
                            <SelectValue>
                              {selectedRecipe &&
                                renderRecipeIOCompact(selectedRecipe)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="max-w-[400px]">
                            {line.availableRecipes.map((recipe) => (
                              <SelectItem
                                key={recipe.id}
                                value={recipe.id}
                                className="text-xs"
                              >
                                <div className="flex flex-col gap-1 py-1">
                                  <span className="font-medium text-xs">
                                    {recipe.id}
                                  </span>
                                  {renderRecipeIOFull(recipe)}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : selectedRecipe ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">
                              {renderRecipeIOCompact(selectedRecipe)}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-[300px]">
                            <div className="text-xs">
                              <div className="font-medium mb-2">
                                {selectedRecipe.id}
                              </div>
                              {renderRecipeIOFull(selectedRecipe)}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          无配方
                        </div>
                      )}
                    </TableCell>

                    {/* 设施图标 */}
                    <TableCell className="p-2">
                      {line.isRawMaterial ? (
                        <div className="flex justify-center">-</div>
                      ) : line.facility ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex justify-center cursor-help">
                              {line.facility.iconUrl ? (
                                <img
                                  src={line.facility.iconUrl}
                                  alt={getFacilityName(line.facility)}
                                  className="h-8 w-8 object-contain"
                                />
                              ) : (
                                <div className="h-8 w-8 bg-muted rounded flex items-center justify-center">
                                  <span className="text-[10px]">🏭</span>
                                </div>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">
                              {getFacilityName(line.facility)}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <div className="flex justify-center">-</div>
                      )}
                    </TableCell>

                    {/* 机器数量 */}
                    <TableCell className="text-right font-mono text-sm p-2">
                      {line.isRawMaterial
                        ? 0
                        : formatNumber(line.facilityCount, 1)}
                    </TableCell>

                    {/* 总功耗 */}
                    <TableCell className="text-right font-mono text-sm p-2">
                      {line.isRawMaterial ? 0 : formatNumber(totalPower, 0)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
