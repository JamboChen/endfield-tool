import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Item, ItemId } from "@/types";
import { useTranslation } from "react-i18next";
import { getItemName } from "@/lib/i18n-helpers";

type AddTargetDialogGridProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Item[];
  existingTargetIds: ItemId[];
  onAddTarget: (itemId: ItemId, rate: number) => void;
};

export default function AddTargetDialogGrid({
  open,
  onOpenChange,
  items,
  existingTargetIds,
  onAddTarget,
}: AddTargetDialogGridProps) {
  const { t } = useTranslation("dialog");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<ItemId | null>(null);
  const [defaultRate, setDefaultRate] = useState(10);

  const availableItems = items.filter(
    (item) => !existingTargetIds.includes(item.id) && item.asTarget !== false,
  );

  const filteredItems = availableItems.filter((item) => {
    const name = getItemName(item).toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || item.id.toLowerCase().includes(query);
  });

  const handleAddTarget = () => {
    if (selectedItemId) {
      onAddTarget(selectedItemId, defaultRate);
      setSelectedItemId(null);
      setSearchQuery("");
      onOpenChange(false);
    }
  };

  const handleItemClick = (itemId: ItemId) => {
    setSelectedItemId(itemId);
  };

  const handleItemDoubleClick = (itemId: ItemId) => {
    onAddTarget(itemId, defaultRate);
    setSelectedItemId(null);
    setSearchQuery("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[80vw]! h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          {/* Search bar and default rate */}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">
                {t("defaultRate")}:
              </Label>
              <Input
                type="number"
                value={defaultRate}
                onChange={(e) => setDefaultRate(Number(e.target.value))}
                className="h-9 w-24"
                min="0.1"
                step="0.1"
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {t("rateUnit")}
              </span>
            </div>
          </div>

          {/* Stable scrollbar gutter prevents layout shift */}
          <div className="flex-1 rounded-md border overflow-auto [scrollbar-gutter:stable]">
            {filteredItems.length === 0 ? (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <p className="text-muted-foreground">
                  {availableItems.length === 0
                    ? t("allItemsAdded")
                    : t("noMatchingItems")}
                </p>
              </div>
            ) : (
              <div className="p-3 grid grid-cols-8 xl:grid-cols-10 gap-3">
                {filteredItems.map((item) => (
                  <ItemButton
                    key={item.id}
                    item={item}
                    isSelected={selectedItemId === item.id}
                    onClick={() => handleItemClick(item.id)}
                    onDoubleClick={() => handleItemDoubleClick(item.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer hint and buttons */}
          <div className="flex items-center justify-between pt-3 border-t shrink-0">
            <div className="text-xs text-muted-foreground">
              {selectedItemId ? (
                <span>
                  {t("hint", {
                    selected: getItemName(
                      items.find((i) => i.id === selectedItemId)!,
                    ),
                  })}
                </span>
              ) : (
                <span>{t("clickToSelectDoubleClickToAdd")}</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={handleAddTarget} disabled={!selectedItemId}>
                {t("add")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ItemButtonProps = {
  item: Item;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
};

function ItemButton({
  item,
  isSelected,
  onClick,
  onDoubleClick,
}: ItemButtonProps) {
  const { t } = useTranslation("dialog");

  return (
    <Button
      variant="outline"
      className={`
        relative aspect-square w-full h-auto p-3
        transition-colors
        ${
          isSelected
            ? "bg-primary/10 border-primary border-2"
            : "hover:bg-accent active:bg-accent/70"
        }
      `}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={getItemName(item)}
    >
      <div className="flex items-center justify-center w-full h-full">
        {item.iconUrl ? (
          <img
            src={item.iconUrl}
            alt={getItemName(item)}
            className="w-full h-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full bg-muted rounded flex items-center justify-center">
            <span className="text-xs text-muted-foreground">{t("noIcon")}</span>
          </div>
        )}
      </div>
    </Button>
  );
}
