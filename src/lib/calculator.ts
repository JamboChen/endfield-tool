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
} from "@/types";
import { solveLinearSystem } from "./linear-solver";
import { forcedRawMaterials } from "@/data";

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

// ============ Internal Data Structures ============

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

  // Physical flow edges: Item → Recipe → Item
  itemConsumedBy: Map<ItemId, Set<RecipeId>>; // recipes consuming this item
  itemProducedBy: Map<ItemId, RecipeId>; // recipe producing this item

  recipeInputs: Map<RecipeId, Set<ItemId>>; // items consumed by recipe
  recipeOutput: Map<RecipeId, ItemId>; // item produced by recipe

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

// ============ Helper Functions ============

const getOrThrow = <K, V>(map: Map<K, V>, key: K, type: string): V => {
  const value = map.get(key);
  if (!value) throw new Error(`${type} not found: ${key}`);
  return value;
};

const calcRate = (amount: number, craftingTime: number): number =>
  (amount * 60) / craftingTime;

// ============ Phase 1: Build Bipartite Graph ============

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

    // Find available recipes
    const availableRecipes = Array.from(maps.recipeMap.values()).filter((r) =>
      r.outputs.some((o) => o.itemId === itemId),
    );

    if (availableRecipes.length === 0) {
      graph.itemNodes.get(itemId)!.isRawMaterial = true;
      graph.rawMaterials.add(itemId);
      return;
    }

    // Select recipe
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

    // Create recipe node if not exists
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

    // Build edges: Item → Recipe (produce edge)
    graph.itemProducedBy.set(itemId, selectedRecipe.id);

    // Build edges: Recipe → Item (consume edges)
    selectedRecipe.inputs.forEach((input) => {
      graph.recipeInputs.get(selectedRecipe.id)!.add(input.itemId);

      if (!graph.itemConsumedBy.has(input.itemId)) {
        graph.itemConsumedBy.set(input.itemId, new Set());
      }
      graph.itemConsumedBy.get(input.itemId)!.add(selectedRecipe.id);

      // Recursive traverse
      traverse(input.itemId);
    });
  }

  targets.forEach(({ itemId }) => traverse(itemId));

  return graph;
}

// ============ Phase 2: Detect SCCs (Tarjan's Algorithm) ============

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

    // Get successors based on physical flow
    const successors: Array<[string, "item" | "recipe"]> = [];

    if (nodeType === "item") {
      // Item → Recipe (produce edge)
      const producerRecipe = graph.itemProducedBy.get(nodeId as ItemId);
      if (producerRecipe) {
        successors.push([producerRecipe, "recipe"]);
      }
    } else {
      // Recipe → Items (consume edges)
      const inputs = graph.recipeInputs.get(nodeId as RecipeId) || new Set();
      inputs.forEach((itemId) => {
        successors.push([itemId, "item"]);
      });
    }

    // Visit successors
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

    // Found SCC root
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

      // Only record if it's a real cycle: total nodes > 1
      if (sccItems.size + sccRecipes.size > 1) {
        const externalInputs = new Set<ItemId>();

        // Find external inputs
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

  // Run Tarjan from all item nodes
  graph.itemNodes.forEach((_, itemId) => {
    if (!indices.has(itemId)) {
      strongConnect(itemId, "item");
    }
  });

  return sccs;
}

// ============ Phase 3: Build Condensed DAG + Topo Sort ============

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

  // Create condensed nodes
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

  // Build condensed edges
  const addEdge = (fromId: string, toId: string) => {
    const fromCondensed = nodeToSCC.get(fromId) || fromId;
    const toCondensed = nodeToSCC.get(toId) || toId;

    if (fromCondensed !== toCondensed) {
      condensedEdges.get(fromCondensed)!.add(toCondensed);
    }
  };

  // Add edges: Item → Recipe
  graph.itemProducedBy.forEach((recipeId, itemId) => {
    addEdge(itemId, recipeId);
  });

  // Add edges: Recipe → Items
  graph.recipeInputs.forEach((inputs, recipeId) => {
    inputs.forEach((itemId) => {
      addEdge(recipeId, itemId);
    });
  });

  // Topological sort (reversed: targets first)
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

  // Reverse to get targets → raw materials order
  return topoOrder.reverse();
}

// ============ Phase 4: Calculate Flows ============

function calculateFlows(
  graph: BipartiteGraph,
  condensedOrder: CondensedNode[],
  targetRates: Map<ItemId, number>,
): FlowData {
  const itemDemands = new Map<ItemId, number>();
  const recipeFacilityCounts = new Map<RecipeId, number>();

  // Initialize target demands
  targetRates.forEach((rate, itemId) => {
    itemDemands.set(itemId, rate);
    console.log(`[calculateFlows] Init target: ${itemId} = ${rate}`);
  });

  // Process in reverse topological order
  condensedOrder.forEach((node) => {
    if (node.type === "scc") {
      console.log(`[calculateFlows] Processing SCC: ${node.scc.id}`);
      solveSCCFlow(node.scc, graph, itemDemands, recipeFacilityCounts);
    } else if (node.type === "recipe") {
      const recipeData = graph.recipeNodes.get(node.recipeId)!;
      const outputItemId = recipeData.outputItemId;
      const outputDemand = itemDemands.get(outputItemId) || 0;

      const outputAmount = recipeData.recipe.outputs.find(
        (o) => o.itemId === outputItemId,
      )!.amount;
      const outputRate = calcRate(outputAmount, recipeData.recipe.craftingTime);
      const facilityCount = outputDemand / outputRate;

      recipeFacilityCounts.set(node.recipeId, facilityCount);

      console.log(
        `[calculateFlows] Recipe ${node.recipeId}: outputDemand=${outputDemand}, facilityCount=${facilityCount}`,
      );

      // Push demands to inputs
      recipeData.recipe.inputs.forEach((input) => {
        const inputDemand =
          calcRate(input.amount, recipeData.recipe.craftingTime) *
          facilityCount;
        itemDemands.set(
          input.itemId,
          (itemDemands.get(input.itemId) || 0) + inputDemand,
        );
        console.log(
          `[calculateFlows] Recipe ${node.recipeId} -> input ${input.itemId}: +${inputDemand} = ${itemDemands.get(input.itemId)}`,
        );
      });
    }
  });

  console.log(
    "[calculateFlows] Final itemDemands:",
    Array.from(itemDemands.entries()),
  );
  console.log(
    "[calculateFlows] Final recipeFacilityCounts:",
    Array.from(recipeFacilityCounts.entries()),
  );

  return { itemDemands, recipeFacilityCounts };
}

function solveSCCFlow(
  scc: SCCInfo,
  graph: BipartiteGraph,
  itemDemands: Map<ItemId, number>,
  recipeFacilityCounts: Map<RecipeId, number>,
) {
  const externalDemands = new Map<ItemId, number>();

  // Collect external demands for each item in SCC
  scc.items.forEach((itemId) => {
    const demand = itemDemands.get(itemId) || 0;
    if (demand > 0) {
      externalDemands.set(itemId, demand);
    }
  });

  if (externalDemands.size === 0) return;

  // Build linear system: A * x = b
  const itemsList = Array.from(scc.items);
  const recipesList = Array.from(scc.recipes).map(
    (rid) => graph.recipeNodes.get(rid)!.recipe,
  );

  const n = itemsList.length;

  if (recipesList.length !== n) {
    console.warn(
      `SCC ${scc.id} has ${n} items but ${recipesList.length} recipes`,
    );
    return;
  }

  const matrix: number[][] = [];
  const constants: number[] = [];

  for (let i = 0; i < n; i++) {
    const itemId = itemsList[i];
    const row = new Array(n).fill(0);

    for (let j = 0; j < n; j++) {
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

  // Update facility counts
  for (let i = 0; i < n; i++) {
    if (solution[i] < -1e-9) {
      console.warn(`Negative facility count in SCC ${scc.id}`);
      return;
    }
    recipeFacilityCounts.set(recipesList[i].id, Math.max(0, solution[i]));
  }

  // Push demands to external inputs
  scc.externalInputs.forEach((inputItemId) => {
    let totalConsumption = 0;

    scc.recipes.forEach((recipeId) => {
      const recipeData = graph.recipeNodes.get(recipeId)!;
      const facilityCount = recipeFacilityCounts.get(recipeId) || 0;
      const input = recipeData.recipe.inputs.find(
        (i) => i.itemId === inputItemId,
      );

      if (input) {
        totalConsumption +=
          calcRate(input.amount, recipeData.recipe.craftingTime) *
          facilityCount;
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

// ============ Phase 5: Convert to ProductionNode Tree ============

function convertToProductionNodeTree(
  graph: BipartiteGraph,
  flowData: FlowData,
  targets: Array<{ itemId: ItemId; rate: number }>,
  sccs: SCCInfo[],
  maps: ProductionMaps,
): { rootNodes: ProductionNode[]; detectedCycles: DetectedCycle[] } {
  const sccSet = new Set<ItemId>();
  sccs.forEach((scc) => scc.items.forEach((item) => sccSet.add(item)));

  function buildNode(
    itemId: ItemId,
    visitedPath: Set<ItemId>,
    isDirectTarget: boolean,
    parentDemand?: number,
  ): ProductionNode {
    const item = getOrThrow(maps.itemMap, itemId, "Item");

    console.log(
      `[buildNode] itemId=${itemId}, parentDemand=${parentDemand}, isDirectTarget=${isDirectTarget}`,
    );

    // Check for cycle
    if (visitedPath.has(itemId)) {
      console.log(`[buildNode] Cycle detected for ${itemId}`);
      return {
        item,
        targetRate: parentDemand || flowData.itemDemands.get(itemId) || 0,
        recipe: null,
        facility: null,
        facilityCount: 0,
        isRawMaterial: false,
        isTarget: false,
        dependencies: [],
        isCyclePlaceholder: true,
        cycleItemId: itemId,
      };
    }

    const itemNode = graph.itemNodes.get(itemId);

    if (!itemNode || itemNode.isRawMaterial) {
      console.log(`[buildNode] ${itemId} is raw material`);
      return {
        item,
        targetRate: parentDemand || flowData.itemDemands.get(itemId) || 0,
        recipe: null,
        facility: null,
        facilityCount: 0,
        isRawMaterial: true,
        isTarget: isDirectTarget,
        dependencies: [],
      };
    }

    const producerRecipeId = graph.itemProducedBy.get(itemId);
    if (!producerRecipeId) {
      console.log(`[buildNode] ${itemId} has no producer recipe`);
      return {
        item,
        targetRate: parentDemand || flowData.itemDemands.get(itemId) || 0,
        recipe: null,
        facility: null,
        facilityCount: 0,
        isRawMaterial: true,
        isTarget: isDirectTarget,
        dependencies: [],
      };
    }

    const recipeData = graph.recipeNodes.get(producerRecipeId)!;
    const facilityCount =
      flowData.recipeFacilityCounts.get(producerRecipeId) || 0;

    console.log(
      `[buildNode] ${itemId} recipe=${producerRecipeId}, facilityCount=${facilityCount}`,
    );

    const newVisitedPath = new Set(visitedPath);
    newVisitedPath.add(itemId);

    // Build dependencies with their specific demand from this recipe
    const dependencies = recipeData.recipe.inputs.map((input) => {
      const inputDemand =
        calcRate(input.amount, recipeData.recipe.craftingTime) * facilityCount;
      console.log(
        `[buildNode] ${itemId} -> input ${input.itemId}, inputDemand=${inputDemand}`,
      );
      return buildNode(input.itemId, newVisitedPath, false, inputDemand);
    });

    const nodeTargetRate =
      parentDemand !== undefined
        ? parentDemand
        : isDirectTarget
          ? flowData.itemDemands.get(itemId) || 0
          : calcRate(
              recipeData.recipe.outputs.find((o) => o.itemId === itemId)!
                .amount,
              recipeData.recipe.craftingTime,
            ) * facilityCount;

    console.log(
      `[buildNode] ${itemId} final targetRate=${nodeTargetRate}, facilityCount=${facilityCount}`,
    );

    return {
      item,
      targetRate: nodeTargetRate,
      recipe: recipeData.recipe,
      facility: recipeData.facility,
      facilityCount,
      isRawMaterial: false,
      isTarget: isDirectTarget,
      dependencies,
    };
  }

  const rootNodes = targets.map(
    (t) => buildNode(t.itemId, new Set(), true, t.rate), // Pass target rate as parent demand
  );

  // Build detected cycles
  const detectedCycles: DetectedCycle[] = sccs.map((scc) => {
    const cycleNodes: ProductionNode[] = Array.from(scc.recipes).map(
      (recipeId) => {
        const recipeData = graph.recipeNodes.get(recipeId)!;
        const facilityCount = flowData.recipeFacilityCounts.get(recipeId) || 0;
        const outputAmount = recipeData.recipe.outputs.find(
          (o) => o.itemId === recipeData.outputItemId,
        )!.amount;

        return {
          item: graph.itemNodes.get(recipeData.outputItemId)!.item,
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

  return { rootNodes, detectedCycles };
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

  // Phase 1: Build bipartite graph
  const graph = buildBipartiteGraph(
    targets,
    maps,
    recipeOverrides,
    recipeSelector,
    manualRawMaterials,
  );

  // Phase 2: Detect SCCs
  const sccs = detectSCCs(graph);

  // Phase 3: Build condensed DAG and topological sort
  const condensedOrder = buildCondensedDAGAndSort(graph, sccs);

  // Phase 4: Calculate flows
  const targetRatesMap = new Map(targets.map((t) => [t.itemId, t.rate]));
  const flowData = calculateFlows(graph, condensedOrder, targetRatesMap);

  // Phase 5: Convert to ProductionNode tree (for UI compatibility)
  const { rootNodes, detectedCycles } = convertToProductionNodeTree(
    graph,
    flowData,
    targets,
    sccs,
    maps,
  );

  return {
    dependencyRootNodes: rootNodes,
    detectedCycles,
  };
}
