import type { Metadata } from "next";
import DeskPage from "@/app/components/layout/desk-page";

export const metadata: Metadata = { title: "Calls — Wax" };

export default function CallsPage() {
  return <DeskPage tab="calls" />;
}

// These routes read the session and the database on every request, so they
// intentionally block instead of producing a static shell.
export const instant = false;
