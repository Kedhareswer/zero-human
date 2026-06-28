import { serve } from "inngest/next";
import { inngest } from "../../../src/inngest/client";
import { functions } from "../../../src/inngest/functions";

// Inngest control-plane endpoint. Trigger a run by sending the `zh/company.run`
// event (Inngest dashboard, SDK, or a Vercel Cron). The durable loop runs on
// Inngest infra, not in this serverless function.
export const { GET, POST, PUT } = serve({ client: inngest, functions });
