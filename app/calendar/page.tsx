import type { Metadata } from "next";
import DeskPage from "@/app/components/layout/desk-page";

export const metadata: Metadata = { title: "Calendar — Wax" };

export default function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  return <DeskPage tab="calendar" searchParams={searchParams} />;
}

// Reads the session and the week's blocks on every request.
export const instant = false;
