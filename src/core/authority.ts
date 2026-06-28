// Pure authority resolver — the most security-critical function in the system.
// Delegation is allowed only down one's own subtree; cross-line requests must be
// approved by the nearest-common-ancestor. A jailbroken IC cannot command the CEO.

export interface OrgTree {
  /** positionId -> parentId (null for the root). */
  parent: Map<string, string | null>;
  /** positionId -> child positionIds. */
  children: Map<string, string[]>;
}

export function buildTree(edges: Array<{ positionId: string; parentId: string | null }>): OrgTree {
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  for (const { positionId } of edges) children.set(positionId, []);
  for (const { positionId, parentId } of edges) {
    parent.set(positionId, parentId);
    if (parentId !== null) {
      const list = children.get(parentId) ?? [];
      list.push(positionId);
      children.set(parentId, list);
    }
  }
  return { parent, children };
}

/** All transitive subordinates of a position (excludes the position itself). */
export function descendants(tree: OrgTree, root: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(tree.children.get(root) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue; // cycle guard
    out.add(cur);
    for (const c of tree.children.get(cur) ?? []) stack.push(c);
  }
  return out;
}

export function isDescendant(tree: OrgTree, ancestor: string, node: string): boolean {
  return descendants(tree, ancestor).has(node);
}

/** A manager may directly assign work only to a position in its own subtree. */
export function canAssign(tree: OrgTree, assigner: string, assignee: string): boolean {
  if (assigner === assignee) return false;
  return isDescendant(tree, assigner, assignee);
}

function ancestorChain(tree: OrgTree, node: string): string[] {
  const chain: string[] = [];
  let cur: string | null | undefined = node;
  const seen = new Set<string>();
  while (cur != null && !seen.has(cur)) {
    chain.push(cur);
    seen.add(cur);
    cur = tree.parent.get(cur) ?? null;
  }
  return chain;
}

/** Nearest common ancestor — where a cross-line approval routes. */
export function nearestCommonAncestor(tree: OrgTree, a: string, b: string): string | null {
  const ancestorsOfA = new Set(ancestorChain(tree, a));
  for (const node of ancestorChain(tree, b)) {
    if (ancestorsOfA.has(node)) return node;
  }
  return null;
}

// ---- Invariants (checked when mutating the org) ----

export function hasCycle(tree: OrgTree): boolean {
  for (const start of tree.parent.keys()) {
    const seen = new Set<string>();
    let cur: string | null | undefined = start;
    while (cur != null) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = tree.parent.get(cur) ?? null;
    }
  }
  return false;
}

export function rootCount(tree: OrgTree): number {
  let n = 0;
  for (const p of tree.parent.values()) if (p === null) n++;
  return n;
}
