/**
 * Create a target sink node ID.
 *
 * @example
 * createTargetSinkId("item_iron_powder") // "target-sink-item_iron_powder"
 */
export function createTargetSinkId(itemId: string): string {
  return `target-sink-${itemId}`;
}
