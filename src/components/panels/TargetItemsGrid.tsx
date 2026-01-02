import { memo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";
import type { Item, ItemId } from "@/types";
import { useTranslation } from "react-i18next";
import { getItemName } from "@/lib/i18n-helpers";

export type ProductionTarget = {
  itemId: ItemId;
  rate: number;
};

type TargetItemsGridProps = {
  targets: ProductionTarget[];
  items: Item[];
  onTargetChange: (index: number, rate: number) => void;
  onTargetRemove: (index: number) => void;
  onAddClick: () => void;
  maxTargets?: number;
};

const TargetItemsGrid = memo(function TargetItemsGrid({
  targets,
  items,
  onTargetChange,
  onTargetRemove,
  onAddClick,
  maxTargets = 12,
}: TargetItemsGridProps) {
  const { t } = useTranslation("targets");
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const getItemById = (itemId: string) => {
    return items.find((i) => i.id === itemId);
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      {/* 已有目标 */}
      {targets.map((target, index) => {
        const item = getItemById(target.itemId);
        if (!item) return null;

        const isFocused = focusedIndex === index;

        return (
          <Card
            key={`${target.itemId}-${index}`}
            className={`relative group hover:shadow-md transition-all ${
              isFocused ? "ring-2 ring-primary" : ""
            }`}
          >
            {/* 删除按钮 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onTargetRemove(index)}
              className="absolute -top-1 -right-1 h-5 w-5 p-0 rounded-full bg-background shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground z-10"
              aria-label={t("removeTarget")}
            >
              <X className="h-3 w-3" />
            </Button>

            <div className="p-3 space-y-2">
              {/* 物品图标和名称 */}
              <div className="flex flex-col items-center gap-2">
                {item.iconUrl ? (
                  <div className="h-12 w-12 flex items-center justify-center">
                    <img
                      src={item.iconUrl}
                      alt={getItemName(item)}
                      className="h-full w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="h-12 w-12 bg-muted rounded flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">
                      {t("noIcon")}
                    </span>
                  </div>
                )}
                <div className="text-xs font-medium text-center line-clamp-2 w-full px-1 min-h-8">
                  {getItemName(item)}
                </div>
              </div>

              {/* 产量输入 */}
              <div className="space-y-1">
                <Input
                  type="number"
                  value={target.rate}
                  onChange={(e) =>
                    onTargetChange(index, Number(e.target.value))
                  }
                  onFocus={() => setFocusedIndex(index)}
                  onBlur={() => setFocusedIndex(null)}
                  className="h-7 text-xs text-center font-mono"
                  min="0.1"
                  step="0.1"
                  aria-label={t("rateInput")}
                />
                <div className="text-[10px] text-center text-muted-foreground">
                  {t("rateUnit")}
                </div>
              </div>
            </div>
          </Card>
        );
      })}

      {/* 添加按钮 */}
      {targets.length < maxTargets && (
        <Card
          className="border-dashed hover:border-primary hover:bg-accent/50 cursor-pointer transition-all"
          onClick={onAddClick}
        >
          <div className="h-full flex flex-col items-center justify-center p-3 min-h-[140px]">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-2">
              <Plus className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="text-xs text-muted-foreground text-center">
              {t("addTarget")}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
});

export default TargetItemsGrid;
