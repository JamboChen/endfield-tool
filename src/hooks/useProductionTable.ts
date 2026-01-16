import { useMemo } from "react";
import type {
  ProductionDependencyGraph,
  ProductionNode,
  ItemId,
  RecipeId,
  Item,
  Recipe,
  Facility,
} from "@/types";
import type { ProductionLineData } from "@/components/production/ProductionTable";
import { createNodeKeyFromData } from "@/lib/node-keys";

type MergedNode = {
  item: Item;
  totalRate: number;
  recipe: Recipe | null;
  facility: Facility | null;
  totalFacilityCount: number;
  isRawMaterial: boolean;
  isTarget: boolean;
  dependencies: Set<string>;
  level: number;
};

/**
 * Collects all produced (non-raw) item IDs from the tree.
 */
function collectProducedItems(nodes: ProductionNode[]): Set<ItemId> {
  const produced = new Set<ItemId>();

  const traverse = (node: ProductionNode) => {
    if (node.isCyclePlaceholder) {
      node.dependencies.forEach(traverse);
      return;
    }
    if (!node.isRawMaterial && node.recipe) {
      produced.add(node.item.id);
    }
    node.dependencies.forEach(traverse);
  };

  nodes.forEach(traverse);
  return produced;
}

/**
 * Checks if a node is a circular dependency.
 */
function isCircularDep(node: ProductionNode, produced: Set<ItemId>): boolean {
  return (
    !node.isCyclePlaceholder && node.isRawMaterial && produced.has(node.item.id)
  );
}

/**
 * Merges duplicate production nodes for table view.
 */
function mergeNodes(
  rootNodes: ProductionNode[],
  producedItemIds: Set<ItemId>,
): Map<string, MergedNode> {
  const merged = new Map<string, MergedNode>();

  const traverse = (node: ProductionNode) => {
    if (node.isCyclePlaceholder || isCircularDep(node, producedItemIds)) {
      node.dependencies.forEach(traverse);
      return;
    }

    const key = createNodeKeyFromData(
      node.item.id,
      node.recipe?.id || null,
      node.isRawMaterial,
    );

    const existing = merged.get(key);

    if (existing) {
      existing.totalRate += node.targetRate;
      existing.totalFacilityCount += node.facilityCount;
      if (node.isTarget) existing.isTarget = true;

      node.dependencies.forEach((dep) => {
        if (!isCircularDep(dep, producedItemIds)) {
          existing.dependencies.add(
            createNodeKeyFromData(
              dep.item.id,
              dep.recipe?.id || null,
              dep.isRawMaterial,
            ),
          );
        }
      });
    } else {
      const dependencies = new Set<string>();
      node.dependencies.forEach((dep) => {
        if (!isCircularDep(dep, producedItemIds)) {
          dependencies.add(
            createNodeKeyFromData(
              dep.item.id,
              dep.recipe?.id || null,
              dep.isRawMaterial,
            ),
          );
        }
      });

      merged.set(key, {
        item: node.item,
        totalRate: node.targetRate,
        recipe: node.recipe,
        facility: node.facility,
        totalFacilityCount: node.facilityCount,
        isRawMaterial: node.isRawMaterial,
        isTarget: node.isTarget,
        dependencies,
        level: 0, // Will be calculated later
      });
    }

    node.dependencies.forEach(traverse);
  };

  rootNodes.forEach(traverse);
  return merged;
}

/**
 * Calculates depth levels for merged nodes using topological order.
 */
function calculateLevels(merged: Map<string, MergedNode>): void {
  const levels = new Map<string, number>();
  const visited = new Set<string>();

  const calcLevel = (key: string): number => {
    if (levels.has(key)) return levels.get(key)!;
    if (visited.has(key)) return 0; // Prevent infinite recursion

    visited.add(key);

    const node = merged.get(key);
    if (!node || node.dependencies.size === 0) {
      levels.set(key, 0);
      return 0;
    }

    let maxDepLevel = -1;
    node.dependencies.forEach((depKey) => {
      if (merged.has(depKey)) {
        maxDepLevel = Math.max(maxDepLevel, calcLevel(depKey));
      }
    });

    const level = maxDepLevel + 1;
    levels.set(key, level);
    node.level = level;
    return level;
  };

  // Calculate levels for all nodes
  merged.forEach((_, key) => calcLevel(key));
}

/**
 * Sorts merged nodes by level (deepest first) then by tier (highest first).
 */
function sortNodes(merged: Map<string, MergedNode>): MergedNode[] {
  const nodes = Array.from(merged.values());

  return nodes.sort((a, b) => {
    // Sort by level descending (deepest first)
    if (b.level !== a.level) {
      return b.level - a.level;
    }
    // Then by tier descending (highest tier first)
    return b.item.tier - a.item.tier;
  });
}

/**
 * Hook to generate table data from the production plan.
 * Handles merging, sorting, and formatting for the table view.
 */
export function useProductionTable(
  plan: ProductionDependencyGraph | null,
  recipes: Recipe[],
  recipeOverrides: Map<ItemId, RecipeId>,
  manualRawMaterials: Set<ItemId>,
): ProductionLineData[] {
  return useMemo(() => {
    if (!plan || plan.dependencyRootNodes.length === 0) {
      return [];
    }

    // Step 1: Collect produced items
    const producedItemIds = collectProducedItems(plan.dependencyRootNodes);

    // Step 2: Merge duplicate nodes
    const mergedNodes = mergeNodes(plan.dependencyRootNodes, producedItemIds);

    // Step 3: Calculate levels
    calculateLevels(mergedNodes);

    // Step 4: Sort by level and tier
    const sortedNodes = sortNodes(mergedNodes);

    // Step 5: Convert to table data format
    return sortedNodes.map((node) => {
      const availableRecipes = recipes.filter((recipe) =>
        recipe.outputs.some((output) => output.itemId === node.item.id),
      );

      // Determine selected recipe
      let selectedRecipeId: RecipeId | "" = "";
      if (recipeOverrides.has(node.item.id)) {
        selectedRecipeId = recipeOverrides.get(node.item.id)!;
      } else if (node.recipe) {
        selectedRecipeId = node.recipe.id;
      }

      return {
        item: node.item,
        outputRate: node.totalRate,
        availableRecipes,
        selectedRecipeId,
        facility: node.facility,
        facilityCount: node.totalFacilityCount,
        isRawMaterial: node.isRawMaterial,
        isTarget: node.isTarget,
        isManualRawMaterial: manualRawMaterials.has(node.item.id),
      };
    });
  }, [plan, recipes, recipeOverrides, manualRawMaterials]);
}
