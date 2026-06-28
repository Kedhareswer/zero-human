import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "zero-human — run a company with AI agents",
  description: "Orchestration & governance harness: hire agents, set token-salary budgets, govern from one dashboard.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
