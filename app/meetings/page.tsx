import type { Metadata } from "next";
import DeskPage from "@/app/components/layout/desk-page";

export const metadata: Metadata = { title: "Meetings — Wax" };

export default function MeetingsPage() {
  return <DeskPage tab="meetings" />;
}

// These routes read the session and the database on every request, so they
// intentionally block instead of producing a static shell.
export const instant = false;
