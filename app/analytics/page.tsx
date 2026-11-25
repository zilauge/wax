import type { Metadata } from "next";
import DeskPage from "@/app/components/layout/desk-page";

export const metadata: Metadata = { title: "Analytics — Wax" };

export default function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  return <DeskPage tab="analytics" searchParams={searchParams} />;
}

// Reads the session and the database on every request.
export const instant = false;
