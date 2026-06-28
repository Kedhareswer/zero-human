// Minimal governor guard for mutation routes. If ZH_GOVERNOR_TOKEN is set, callers
// must present it as `x-governor-token`. Open in local/demo when unset.
//
// Production upgrade (ULTRAPLAN §12.2): replace with Auth.js (NextAuth) — a single
// governor identity via GitHub OAuth or magic link, session stored in Neon. Agents
// never carry the governor identity.

export function governorAllowed(req: Request): boolean {
  const required = process.env.ZH_GOVERNOR_TOKEN;
  if (!required) return true;
  return req.headers.get("x-governor-token") === required;
}
