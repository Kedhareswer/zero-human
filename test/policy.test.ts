import { describe, it, expect } from "vitest";
import { decide } from "../src/kernel/policy";

describe("PDP — pure, deterministic policy decisions", () => {
  it("grants only tools the agent was given (least privilege)", () => {
    expect(decide({ tool: "web_search", capabilities: ["web_search"], canDelegate: false }).decision).toBe("ALLOW");
    expect(decide({ tool: "web_search", capabilities: [], canDelegate: false }).decision).toBe("DENY");
  });

  it("always allows org communication tools", () => {
    expect(decide({ tool: "submit_work", capabilities: [], canDelegate: false }).decision).toBe("ALLOW");
    expect(decide({ tool: "ask_manager", capabilities: [], canDelegate: false }).decision).toBe("ALLOW");
  });

  it("gates assign_task on delegation authority", () => {
    expect(decide({ tool: "assign_task", capabilities: [], canDelegate: true }).decision).toBe("ALLOW");
    expect(decide({ tool: "assign_task", capabilities: [], canDelegate: false }).decision).toBe("DENY");
  });

  it("requires approval for irreversible / spend-incurring tools", () => {
    for (const tool of ["deploy", "send_email", "spend_ad", "charge_card", "merge_pr", "open_requisition"]) {
      expect(decide({ tool, capabilities: [tool], canDelegate: true }).decision).toBe("REQUIRE_APPROVAL");
    }
  });

  it("is a pure function (same input -> same decision)", () => {
    const ctx = { tool: "deploy", capabilities: ["deploy"], canDelegate: true };
    expect(decide(ctx)).toEqual(decide(ctx));
  });
});
