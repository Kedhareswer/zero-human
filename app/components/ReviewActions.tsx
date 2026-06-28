"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Mark-correct / flag buttons for a pending Review Center work item.
export function ReviewActions({ workItemId, status }: { workItemId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (status !== "PENDING_REVIEW") {
    return <span className={`tag ${status}`}>{status.replace("_", " ")}</span>;
  }

  async function review(verdict: "correct" | "flag") {
    setBusy(true);
    try {
      await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workItemId, verdict }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button className="btn good" disabled={busy} onClick={() => review("correct")}>
        ✓ correct
      </button>
      <button className="btn bad" disabled={busy} onClick={() => review("flag")}>
        ⚑ flag
      </button>
    </span>
  );
}
