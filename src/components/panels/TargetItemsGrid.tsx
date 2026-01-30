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
              className="absolute -top-1 -right-1 h-5 w-5 p-0 rounded-full bg-background shadow-sm [@media(hover:none)]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground z-10"
              aria-label={t("removeTarget")}
            >
              <X className="h-3 w-3" />
            </Button>

            <div className="px-2 space-y-2">
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
                  value={target.rate === 0 ? "" : target.rate}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") {
                      onTargetChange(index, 0);
                    } else {
                      const num = Number(val);
                      if (!isNaN(num)) {
                        onTargetChange(index, num);
                      }
                    }
                  }}
                  onFocus={(e) => {
                    setFocusedIndex(index);
                    e.target.select();
                  }}
                  onBlur={(e) => {
                    if (e.target.value === "" || Number(e.target.value) < 1) {
                      onTargetChange(index, 1);
                    }
                    setFocusedIndex(null);
                  }}
                  className="h-7 text-xs text-center font-mono"
                  min="1"
                  step="1"
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
          className="border-2 border-dashed border-border hover:border-primary hover:bg-accent/30 cursor-pointer transition-all group"
          onClick={onAddClick}
        >
          <div className="h-full flex flex-col items-center justify-center p-2.5 min-h-[140px]">
            <div className="h-10 w-10 border-2 border-dashed border-muted-foreground/40 group-hover:border-primary rounded-sm flex items-center justify-center mb-2 transition-colors">
              <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div className="text-xs text-muted-foreground group-hover:text-foreground transition-colors text-center font-medium">
              {t("addTarget")}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
});

export default TargetItemsGrid;
