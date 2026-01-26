import type {
  Item,
  Recipe,
  Facility,
  ItemId,
  RecipeId,
  FacilityId,
  ProductionNode,
  DetectedCycle,
  ProductionDependencyGraph,
  ProductionGraphNode,
} from "@/types";
import { solveLinearSystem } from "./linear-solver";
import { forcedRawMaterials } from "@/data";
import { calcRate } from "@/lib/utils";

export type RecipeSelector = (
  availableRecipes: Recipe[],
  visitedPath?: Set<ItemId>,
) => Recipe;

export const defaultRecipeSelector: RecipeSelector = (recipes) => recipes[0];

export const smartRecipeSelector: RecipeSelector = (recipes, visitedPath) => {
  if (!visitedPath?.size) return defaultRecipeSelector(recipes);

  const nonCircular = recipes.filter(
    (r) => !r.inputs.some((input) => visitedPath.has(input.itemId)),
  );

  return nonCircular.length > 0 ? nonCircular[0] : recipes[0];
};

type ProductionMaps = {
  itemMap: Map<ItemId, Item>;
  recipeMap: Map<RecipeId, Recipe>;
  facilityMap: Map<FacilityId, Facility>;
};

type ItemNode = {
  itemId: ItemId;
  item: Item;
  isRawMaterial: boolean;
};

type RecipeNodeData = {
  recipeId: RecipeId;
  recipe: Recipe;
  facility: Facility;
  outputItemId: ItemId;
};

type BipartiteGraph = {
  itemNodes: Map<ItemId, ItemNode>;
  recipeNodes: Map<RecipeId, RecipeNodeData>;

  itemConsumedBy: Map<ItemId, Set<RecipeId>>;
  itemProducedBy: Map<ItemId, RecipeId>;

  recipeInputs: Map<RecipeId, Set<ItemId>>;
  recipeOutput: Map<RecipeId, ItemId>;

  targets: Set<ItemId>;
  rawMaterials: Set<ItemId>;
};
type SCCInfo = {
  id: string;
  items: Set<ItemId>;
  recipes: Set<RecipeId>;
  externalInputs: Set<ItemId>;
};

type CondensedNode =
  | { type: "item"; itemId: ItemId }
  | { type: "recipe"; recipeId: RecipeId }
  | { type: "scc"; scc: SCCInfo };

type FlowData = {
  itemDemands: Map<ItemId, number>;
  recipeFacilityCounts: Map<RecipeId, number>;
};

const getOrThrow = <K, V>(map: Map<K, V>, key: K, type: string): V => {
  const value = map.get(key);
  if (!value) throw new Error(`${type} not found: ${key}`);
  return value;
};

function buildBipartiteGraph(
  targets: Array<{ itemId: ItemId; rate: number }>,
  maps: ProductionMaps,
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  manualRawMaterials?: Set<ItemId>,
): BipartiteGraph {
  const graph: BipartiteGraph = {
    itemNodes: new Map(),
    recipeNodes: new Map(),
    itemConsumedBy: new Map(),
    itemProducedBy: new Map(),
    recipeInputs: new Map(),
    recipeOutput: new Map(),
    targets: new Set(targets.map((t) => t.itemId)),
    rawMaterials: new Set(),
  };

  const visitedItems = new Set<ItemId>();

  function traverse(itemId: ItemId) {
    if (visitedItems.has(itemId)) return;
    visitedItems.add(itemId);

    const item = getOrThrow(maps.itemMap, itemId, "Item");

    const isRaw =
      forcedRawMaterials.has(itemId) ||
      (manualRawMaterials?.has(itemId) ?? false);

    graph.itemNodes.set(itemId, {
      itemId,
      item,
      isRawMaterial: isRaw,
    });

    if (isRaw) {
      graph.rawMaterials.add(itemId);
      return;
    }

    const availableRecipes = Array.from(maps.recipeMap.values()).filter((r) =>
      r.outputs.some((o) => o.itemId === itemId),
    );

    if (availableRecipes.length === 0) {
      graph.itemNodes.get(itemId)!.isRawMaterial = true;
      graph.rawMaterials.add(itemId);
      return;
    }

    const selectedRecipe = recipeOverrides?.has(itemId)
      ? getOrThrow(
        maps.recipeMap,
        recipeOverrides.get(itemId)!,
        "Override recipe",
      )
      : recipeSelector(availableRecipes, new Set([itemId]));

    const facility = getOrThrow(
      maps.facilityMap,
      selectedRecipe.facilityId,
      "Facility",
    );

    if (!graph.recipeNodes.has(selectedRecipe.id)) {
      graph.recipeNodes.set(selectedRecipe.id, {
        recipeId: selectedRecipe.id,
        recipe: selectedRecipe,
        facility,
        outputItemId: itemId,
      });

      graph.recipeOutput.set(selectedRecipe.id, itemId);
      graph.recipeInputs.set(selectedRecipe.id, new Set());
    }

    graph.itemProducedBy.set(itemId, selectedRecipe.id);

    selectedRecipe.inputs.forEach((input) => {
      graph.recipeInputs.get(selectedRecipe.id)!.add(input.itemId);

      if (!graph.itemConsumedBy.has(input.itemId)) {
        graph.itemConsumedBy.set(input.itemId, new Set());
      }
      graph.itemConsumedBy.get(input.itemId)!.add(selectedRecipe.id);

      traverse(input.itemId);
    });
  }

  targets.forEach(({ itemId }) => traverse(itemId));

  return graph;
}

function detectSCCs(graph: BipartiteGraph): SCCInfo[] {
  const sccs: SCCInfo[] = [];
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let index = 0;

  function strongConnect(nodeId: string, nodeType: "item" | "recipe") {
    indices.set(nodeId, index);
    lowlinks.set(nodeId, index);
    index++;
    stack.push(nodeId);
    onStack.add(nodeId);

    const successors: Array<[string, "item" | "recipe"]> = [];

    if (nodeType === "item") {
      const consumerRecipes = graph.itemConsumedBy.get(nodeId as ItemId);
      if (consumerRecipes) {
        consumerRecipes.forEach((recipeId) => {
          successors.push([recipeId, "recipe"]);
        });
      }
    } else {
      const outputItem = graph.recipeOutput.get(nodeId as RecipeId);
      if (outputItem) {
        successors.push([outputItem, "item"]);
      }
    }

    successors.forEach(([succId, succType]) => {
      if (!indices.has(succId)) {
        strongConnect(succId, succType);
        lowlinks.set(
          nodeId,
          Math.min(lowlinks.get(nodeId)!, lowlinks.get(succId)!),
        );
      } else if (onStack.has(succId)) {
        lowlinks.set(
          nodeId,
          Math.min(lowlinks.get(nodeId)!, indices.get(succId)!),
        );
      }
    });

    if (lowlinks.get(nodeId) === indices.get(nodeId)) {
      const sccItems = new Set<ItemId>();
      const sccRecipes = new Set<RecipeId>();

      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);

        if (graph.itemNodes.has(w as ItemId)) {
          sccItems.add(w as ItemId);
        } else {
          sccRecipes.add(w as RecipeId);
        }
      } while (w !== nodeId);

      if (sccItems.size + sccRecipes.size > 1) {
        const externalInputs = new Set<ItemId>();

        sccRecipes.forEach((recipeId) => {
          const inputs = graph.recipeInputs.get(recipeId) || new Set();
          inputs.forEach((inputItemId) => {
            if (!sccItems.has(inputItemId)) {
              externalInputs.add(inputItemId);
            }
          });
        });

        sccs.push({
          id: `scc-${Array.from(sccItems).sort().join("-")}`,
          items: sccItems,
          recipes: sccRecipes,
          externalInputs,
        });
      }
    }
  }

  graph.itemNodes.forEach((_, itemId) => {
    if (!indices.has(itemId)) {
      strongConnect(itemId, "item");
    }
  });

  return sccs;
}

function buildCondensedDAGAndSort(
  graph: BipartiteGraph,
  sccs: SCCInfo[],
): CondensedNode[] {
  const nodeToSCC = new Map<string, string>();

  sccs.forEach((scc) => {
    scc.items.forEach((itemId) => nodeToSCC.set(itemId, scc.id));
    scc.recipes.forEach((recipeId) => nodeToSCC.set(recipeId, scc.id));
  });

  const condensedNodes = new Map<string, CondensedNode>();
  const condensedEdges = new Map<string, Set<string>>();

  sccs.forEach((scc) => {
    condensedNodes.set(scc.id, { type: "scc", scc });
    condensedEdges.set(scc.id, new Set());
  });

  graph.itemNodes.forEach((_, itemId) => {
    if (!nodeToSCC.has(itemId)) {
      condensedNodes.set(itemId, { type: "item", itemId });
      condensedEdges.set(itemId, new Set());
    }
  });

  graph.recipeNodes.forEach((_, recipeId) => {
    if (!nodeToSCC.has(recipeId)) {
      condensedNodes.set(recipeId, { type: "recipe", recipeId });
      condensedEdges.set(recipeId, new Set());
    }
  });

  const addEdge = (fromId: string, toId: string) => {
    const fromCondensed = nodeToSCC.get(fromId) || fromId;
    const toCondensed = nodeToSCC.get(toId) || toId;

    if (fromCondensed !== toCondensed) {
      condensedEdges.get(fromCondensed)!.add(toCondensed);
    }
  };

  graph.itemConsumedBy.forEach((recipeIds, itemId) => {
    recipeIds.forEach((recipeId) => {
      addEdge(itemId, recipeId);
    });
  });

  graph.recipeOutput.forEach((itemId, recipeId) => {
    addEdge(recipeId, itemId);
  });

  const inDegree = new Map<string, number>();
  condensedNodes.forEach((_, nodeId) => {
    inDegree.set(nodeId, 0);
  });

  condensedEdges.forEach((targets) => {
    targets.forEach((target) => {
      inDegree.set(target, (inDegree.get(target) || 0) + 1);
    });
  });

  const queue: string[] = [];
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) queue.push(nodeId);
  });

  const topoOrder: CondensedNode[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    topoOrder.push(condensedNodes.get(nodeId)!);

    condensedEdges.get(nodeId)!.forEach((target) => {
      const newDegree = inDegree.get(target)! - 1;
      inDegree.set(target, newDegree);
      if (newDegree === 0) {
        queue.push(target);
      }
    });
  }

  return topoOrder;
}

function calculateFlows(
  graph: BipartiteGraph,
  condensedOrder: CondensedNode[],
  targetRates: Map<ItemId, number>,
  maps: ProductionMaps,
): FlowData {
  const itemDemands = new Map<ItemId, number>();
  const recipeFacilityCounts = new Map<RecipeId, number>();

  targetRates.forEach((rate, itemId) => {
    itemDemands.set(itemId, rate);
  });

  const reversedOrder = condensedOrder.reverse();

  reversedOrder.forEach((node) => {
    if (node.type === "scc") {
      solveSCCFlow(node.scc, graph, itemDemands, recipeFacilityCounts, maps);
    } else if (node.type === "recipe") {
      const recipeData = graph.recipeNodes.get(node.recipeId)!;
      const recipe = recipeData.recipe;
      const outputItemId = recipeData.outputItemId;
      const outputDemand = itemDemands.get(outputItemId) || 0;
      const outputRate = calcRate(
        recipe.outputs[0].amount,
        recipe.craftingTime,
      );
      const facilityCount = outputRate > 0 ? outputDemand / outputRate : 0;

      recipeFacilityCounts.set(node.recipeId, facilityCount);

      recipe.inputs.forEach((input) => {
        const inputDemand =
          calcRate(input.amount, recipe.craftingTime) * facilityCount;
        itemDemands.set(
          input.itemId,
          (itemDemands.get(input.itemId) || 0) + inputDemand,
        );
      });
    }
  });

  return { itemDemands, recipeFacilityCounts };
}

function solveSCCFlow(
  scc: SCCInfo,
  graph: BipartiteGraph,
  itemDemands: Map<ItemId, number>,
  recipeFacilityCounts: Map<RecipeId, number>,
  maps: ProductionMaps,
) {
  const externalDemands = new Map<ItemId, number>();

  scc.items.forEach((itemId) => {
    let demand = 0;

    const consumers = graph.itemConsumedBy.get(itemId);
    if (consumers) {
      consumers.forEach((recipeId) => {
        if (!scc.recipes.has(recipeId)) {
          const facilityCount = recipeFacilityCounts.get(recipeId) || 0;
          const recipe = maps.recipeMap.get(recipeId)!;
          const input = recipe.inputs.find((i) => i.itemId === itemId);
          if (input) {
            demand +=
              calcRate(input.amount, recipe.craftingTime) * facilityCount;
          }
        }
      });
    }

    if (graph.targets.has(itemId)) {
      demand += itemDemands.get(itemId) || 0;
    }

    if (demand > 0) {
      externalDemands.set(itemId, demand);
    }
  });

  if (externalDemands.size === 0) return;

  const itemsList = Array.from(scc.items);
  const recipesList = Array.from(scc.recipes).map(
    (rid) => maps.recipeMap.get(rid)!,
  );

  const n = itemsList.length;
  const m = recipesList.length;

  if (m === 0 || n === 0) return;

  const matrix: number[][] = [];
  const constants: number[] = [];

  for (let i = 0; i < n; i++) {
    const itemId = itemsList[i];
    const row = new Array(m).fill(0);

    for (let j = 0; j < m; j++) {
      const recipe = recipesList[j];
      const output =
        recipe.outputs.find((o) => o.itemId === itemId)?.amount || 0;
      const input =
        recipe.inputs.find((inp) => inp.itemId === itemId)?.amount || 0;

      const outRate = (output * 60) / recipe.craftingTime;
      const inRate = (input * 60) / recipe.craftingTime;
      row[j] = outRate - inRate;
    }

    matrix.push(row);
    constants.push(externalDemands.get(itemId) || 0);
  }

  const solution = solveLinearSystem(matrix, constants);

  if (!solution) {
    console.warn(`Cannot solve SCC ${scc.id}`);
    return;
  }

  for (let j = 0; j < m; j++) {
    const facilityCount = Math.max(0, solution[j]);
    recipeFacilityCounts.set(recipesList[j].id, facilityCount);
  }

  scc.externalInputs.forEach((inputItemId) => {
    let totalConsumption = 0;

    scc.recipes.forEach((recipeId) => {
      const recipe = maps.recipeMap.get(recipeId)!;
      const facilityCount = recipeFacilityCounts.get(recipeId) || 0;
      const input = recipe.inputs.find((i) => i.itemId === inputItemId);

      if (input) {
        totalConsumption +=
          calcRate(input.amount, recipe.craftingTime) * facilityCount;
      }
    });

    if (totalConsumption > 0) {
      itemDemands.set(
        inputItemId,
        (itemDemands.get(inputItemId) || 0) + totalConsumption,
      );
    }
  });
}

function buildProductionGraph(
  graph: BipartiteGraph,
  flowData: FlowData,
  sccs: SCCInfo[],
  maps: ProductionMaps,
): ProductionDependencyGraph {
  const nodes = new Map<string, ProductionGraphNode>();
  const edges: Array<{ from: string; to: string }> = [];

  // Add item nodes
  graph.itemNodes.forEach((itemNode, itemId) => {
    const producerRecipeId = graph.itemProducedBy.get(itemId);
    let productionRate = 0;

    if (producerRecipeId) {
      // Produced item: calculate from recipe
      const recipe = maps.recipeMap.get(producerRecipeId)!;
      const facilityCount =
        flowData.recipeFacilityCounts.get(producerRecipeId) || 0;
      const output = recipe.outputs[0];
      productionRate =
        calcRate(output.amount, recipe.craftingTime) * facilityCount;
    } else if (itemNode.isRawMaterial) {
      productionRate = flowData.itemDemands.get(itemId) || 0;
    }

    nodes.set(itemId, {
      type: "item",
      itemId,
      item: itemNode.item,
      productionRate,
      isRawMaterial: itemNode.isRawMaterial,
      isTarget: graph.targets.has(itemId),
    });
  });
  // Add recipe nodes
  graph.recipeNodes.forEach((recipeData, recipeId) => {
    nodes.set(recipeId, {
      type: "recipe",
      recipeId,
      recipe: recipeData.recipe,
      facility: recipeData.facility,
      facilityCount: flowData.recipeFacilityCounts.get(recipeId) || 0,
    });
  });

  // Build edges: Item → Recipe (consume)
  graph.itemConsumedBy.forEach((recipeIds, itemId) => {
    recipeIds.forEach((recipeId) => {
      edges.push({ from: itemId, to: recipeId });
    });
  });

  // Build edges: Recipe → Item (produce)
  graph.recipeOutput.forEach((itemId, recipeId) => {
    edges.push({ from: recipeId, to: itemId });
  });

  // Build cycle info
  const detectedCycles: DetectedCycle[] = sccs.map((scc) => {
    const cycleNodes: ProductionNode[] = Array.from(scc.recipes).map(
      (recipeId) => {
        const recipeData = graph.recipeNodes.get(recipeId)!;
        const facilityCount = flowData.recipeFacilityCounts.get(recipeId) || 0;
        const outputItemId = recipeData.outputItemId;
        const outputAmount = recipeData.recipe.outputs[0].amount;

        return {
          item: graph.itemNodes.get(outputItemId)!.item,
          targetRate:
            calcRate(outputAmount, recipeData.recipe.craftingTime) *
            facilityCount,
          recipe: recipeData.recipe,
          facility: recipeData.facility,
          facilityCount,
          isRawMaterial: false,
          isTarget: false,
          dependencies: [],
        };
      },
    );

    return {
      cycleId: scc.id,
      involvedItemIds: Array.from(scc.items),
      breakPointItemId: Array.from(scc.items)[0],
      cycleNodes,
      netOutputs: new Map(),
    };
  });

  return {
    nodes,
    edges,
    targets: graph.targets,
    detectedCycles,
  };
}

export function calculateProductionPlan(
  targets: Array<{ itemId: ItemId; rate: number }>,
  items: Item[],
  recipes: Recipe[],
  facilities: Facility[],
  recipeOverrides?: Map<ItemId, RecipeId>,
  recipeSelector: RecipeSelector = defaultRecipeSelector,
  manualRawMaterials?: Set<ItemId>,
): ProductionDependencyGraph {
  if (targets.length === 0) throw new Error("No targets specified");

  const maps: ProductionMaps = {
    itemMap: new Map(items.map((i) => [i.id, i])),
    recipeMap: new Map(recipes.map((r) => [r.id, r])),
    facilityMap: new Map(facilities.map((f) => [f.id, f])),
  };

  const graph = buildBipartiteGraph(
    targets,
    maps,
    recipeOverrides,
    recipeSelector,
    manualRawMaterials,
  );

  const sccs = detectSCCs(graph);
  const condensedOrder = buildCondensedDAGAndSort(graph, sccs);
  const targetRatesMap = new Map(targets.map((t) => [t.itemId, t.rate]));
  const flowData = calculateFlows(graph, condensedOrder, targetRatesMap, maps);

  return buildProductionGraph(graph, flowData, sccs, maps);
}
