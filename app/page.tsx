import { dollars } from "../src/core/pricing";
import { runDemoSnapshot } from "../src/demo/snapshot";

// Server component: runs the $0 simulated company on each request and renders the
// dashboard from the folded event log. On Vercel this runs in a serverless
// function; in production the run lives in an Inngest durable function (see §11).
export const dynamic = "force-dynamic";

export default async function Page() {
  const s = await runDemoSnapshot();

  return (
    <main className="wrap">
      <h1>zero-human</h1>
      <p className="sub">Run a company with AI agents — manage business goals, not pull requests.</p>

      <div className="grid">
        <section className="panel">
          <h2>Boardroom</h2>
          <p style={{ margin: "0 0 14px" }}>
            <b>Goal:</b> {s.goal}
          </p>
          <div className="kpi">
            <div><span className="n">{s.state}</span><span className="l">org state</span></div>
            <div><span className="n">{dollars(s.totals.usedCents)}</span><span className="l">spent / {dollars(s.totals.capCents)} cap</span></div>
            <div><span className="n" style={{ color: s.hardStops ? "var(--warn)" : undefined }}>{s.hardStops}</span><span className="l">budget hard-stops</span></div>
            <div><span className="n" style={{ color: s.capBreaches ? "var(--bad)" : "var(--good)" }}>{s.capBreaches}</span><span className="l">cap breaches</span></div>
            <div><span className="n">{s.feed.length}</span><span className="l">log events</span></div>
          </div>
        </section>

        <section className="panel">
          <h2>Know what every agent costs · control what every agent spends</h2>
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Provider / Model</th>
                <th>Budget used</th>
                <th className="r">Cost</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {s.agents.map((a) => {
                const pct = a.capCents ? Math.min(1, a.usedCents / a.capCents) : 0;
                return (
                  <tr key={a.positionId}>
                    <td>{a.name}</td>
                    <td className="mono" style={{ color: "var(--muted)" }}>{a.provider}/{a.model}</td>
                    <td>
                      <span className="bar"><span style={{ width: `${Math.round(pct * 100)}%`, background: pct >= 0.999 ? "var(--bad)" : pct > 0.8 ? "var(--warn)" : "var(--accent)" }} /></span>
                    </td>
                    <td className="r mono">{dollars(a.usedCents)} / {dollars(a.capCents)}</td>
                    <td><span className={`tag ${a.state}`}>{a.state}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="cols">
          <section className="panel">
            <h2>Review Center</h2>
            <table>
              <thead><tr><th>Deliverable</th><th>By</th><th>Cites</th><th>Status</th></tr></thead>
              <tbody>
                {s.workItems.map((w) => (
                  <tr key={w.workItemId}>
                    <td>{w.title} <span style={{ color: "var(--muted)" }}>({w.kind})</span></td>
                    <td className="mono">{w.positionId}</td>
                    <td className="r mono">{w.citations}</td>
                    <td><span className={`tag ${w.status}`}>{w.status.replace("_", " ")}</span></td>
                  </tr>
                ))}
                {s.workItems.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>none</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>Governance — approvals</h2>
            <table>
              <thead><tr><th>Action</th><th>By</th><th>Routed to</th><th>Status</th></tr></thead>
              <tbody>
                {s.approvals.map((a) => (
                  <tr key={a.approvalId}>
                    <td className="mono">{a.approvalId}</td>
                    <td className="mono">{a.positionId}</td>
                    <td className="mono">{a.routedTo}</td>
                    <td><span className={`tag ${a.status}`}>{a.status}</span></td>
                  </tr>
                ))}
                {s.approvals.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>no gated actions this run</td></tr>}
              </tbody>
            </table>
          </section>
        </div>

        <section className="panel">
          <h2>Activity — live event feed (tail)</h2>
          <div className="feed">
            {s.feed.slice(-20).map((f) => (
              <div key={f.seq}>
                <span style={{ color: "var(--muted)" }}>{String(f.seq).padStart(3, "0")}</span>{" "}
                <b>{f.type}</b> <span style={{ color: "var(--muted)" }}>{f.actor}</span> — {f.summary}
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="note">
        Everything above is a projection of one hash-chained, replayable event log — simultaneously the audit trail, this
        dashboard, and the regression fixture. This demo runs on the ScriptedAdapter at $0; set <span className="mono">ANTHROPIC_API_KEY</span> to run real agents under the same hard budget caps.
      </p>
    </main>
  );
}
