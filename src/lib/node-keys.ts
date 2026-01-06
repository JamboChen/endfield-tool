import type { ProductionNode } from "@/types";

/**
 * Create a canonical node key from a ProductionNode.
 * Format: itemId__recipeId__type
 *
 * @example
 * createNodeKey(node) // "item_iron_ore__raw__raw"
 * createNodeKey(node) // "item_iron_nugget__furnance_iron_nugget_1__prod"
 */
export function createNodeKey(node: ProductionNode): string {
  const itemId = node.item.id;
  const recipeId = node.recipe?.id ?? "raw";
  const type = node.isRawMaterial ? "raw" : "prod";
  return `${itemId}__${recipeId}__${type}`;
}

/**
 * Create a canonical node key from raw data.
 * Useful when you don't have a full ProductionNode object.
 */
export function createNodeKeyFromData(
  itemId: string,
  recipeId: string | null,
  isRawMaterial: boolean,
): string {
  const recipe = recipeId ?? "raw";
  const type = isRawMaterial ? "raw" : "prod";
  return `${itemId}__${recipe}__${type}`;
}

/**
 * Create a React Flow node ID from a node key.
 * This is used for actual node IDs in the React Flow graph.
 *
 * @example
 * createFlowNodeId("item_iron_ore__raw__raw") // "node-item_iron_ore__raw__raw"
 */
export function createFlowNodeId(nodeKey: string): string {
  return `node-${nodeKey}`;
}

/**
 * Create a React Flow node ID directly from a ProductionNode.
 *
 * @example
 * createFlowNodeIdFromNode(node) // "node-item_iron_ore__raw__raw"
 */
export function createFlowNodeIdFromNode(node: ProductionNode): string {
  return createFlowNodeId(createNodeKey(node));
}

/**
 * Create a target sink node ID.
 *
 * @example
 * createTargetSinkId("item_iron_powder") // "target-sink-item_iron_powder"
 */
export function createTargetSinkId(itemId: string): string {
  return `target-sink-${itemId}`;
}
