import { Inngest } from "inngest";

// Inngest is the execution plane on Vercel (ULTRAPLAN §11): the agent turn loop
// runs as durable steps; the dashboard/API is the control plane.
export const inngest = new Inngest({ id: "zero-human" });
