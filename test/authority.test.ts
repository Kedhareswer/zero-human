import { describe, it, expect } from "vitest";
import { buildTree, canAssign, descendants, nearestCommonAncestor, hasCycle, rootCount } from "../src/core/authority";

// CEO ── CTO ── Eng
//     └─ CMO
const tree = buildTree([
  { positionId: "ceo", parentId: null },
  { positionId: "cto", parentId: "ceo" },
  { positionId: "cmo", parentId: "ceo" },
  { positionId: "eng", parentId: "cto" },
]);

describe("authority resolver (the most security-critical function)", () => {
  it("allows delegation only down one's own subtree", () => {
    expect(canAssign(tree, "ceo", "cto")).toBe(true);
    expect(canAssign(tree, "ceo", "eng")).toBe(true); // transitive
    expect(canAssign(tree, "cto", "eng")).toBe(true);
  });

  it("forbids sibling, upward, and self assignment", () => {
    expect(canAssign(tree, "cto", "cmo")).toBe(false); // sibling / cross-line
    expect(canAssign(tree, "eng", "ceo")).toBe(false); // a jailbroken IC cannot command the CEO
    expect(canAssign(tree, "cto", "ceo")).toBe(false); // upward
    expect(canAssign(tree, "ceo", "ceo")).toBe(false); // self
  });

  it("routes cross-line approvals to the nearest common ancestor", () => {
    expect(nearestCommonAncestor(tree, "eng", "cmo")).toBe("ceo");
    expect(nearestCommonAncestor(tree, "cto", "eng")).toBe("cto");
  });

  it("computes the full subtree", () => {
    expect(descendants(tree, "ceo")).toEqual(new Set(["cto", "cmo", "eng"]));
    expect(descendants(tree, "cmo").size).toBe(0);
  });

  it("holds the org invariants", () => {
    expect(hasCycle(tree)).toBe(false);
    expect(rootCount(tree)).toBe(1);
  });

  it("property: an IC can never command above its own subtree", () => {
    const ic = "eng";
    for (const other of ["ceo", "cto", "cmo"]) {
      expect(canAssign(tree, ic, other)).toBe(false);
    }
  });
});
