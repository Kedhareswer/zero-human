import { NextResponse } from "next/server";
import { runDemoSnapshot } from "../../../src/demo/snapshot";

// GET /api/state — the folded world state as JSON (what the dashboard renders).
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await runDemoSnapshot();
  return NextResponse.json(snapshot);
}
