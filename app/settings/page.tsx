import type { Metadata } from "next";
import DeskPage from "@/app/components/layout/desk-page";

export const metadata: Metadata = { title: "Settings — Wax" };

export default function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  return <DeskPage tab="settings" searchParams={searchParams} />;
}

// These routes read the session and the database on every request, so they
// intentionally block instead of producing a static shell.
export const instant = false;
