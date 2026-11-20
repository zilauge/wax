import type { Metadata } from "next";
import DeskPage from "@/app/components/layout/desk-page";

export const metadata: Metadata = { title: "Inbox — Wax" };

export default function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  return <DeskPage tab="inbox" searchParams={searchParams} />;
}

// These routes read the session and the database on every request, so they
// intentionally block instead of producing a static shell.
export const instant = false;
