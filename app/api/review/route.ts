import { NextResponse } from "next/server";
import { getRuntime } from "../../../src/server/runtime";
import { governorAllowed } from "../../../src/server/auth";

// POST /api/review  { workItemId, verdict: "correct" | "flag", reasons?: string[] }
// Appends a WorkApproved / WorkFlagged event to the runtime event log — the human
// review loop (mark-correct / flag) from the Guru-style Review Center.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!governorAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { workItemId?: string; verdict?: string; reasons?: string[] };
  const { workItemId, verdict } = body;
  if (!workItemId || (verdict !== "correct" && verdict !== "flag")) {
    return NextResponse.json({ error: "expected { workItemId, verdict: 'correct' | 'flag' }" }, { status: 400 });
  }

  const { store } = await getRuntime();
  const meta = { orgId: "org", actor: "human" };
  if (verdict === "correct") {
    await store.append({ type: "WorkApproved", workItemId, by: "human" }, meta);
  } else {
    await store.append({ type: "WorkFlagged", workItemId, by: "human", reasons: body.reasons ?? ["needs revision"] }, meta);
  }
  return NextResponse.json({ ok: true });
}
