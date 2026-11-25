import type { Metadata } from "next";
import DeskPage from "@/app/components/layout/desk-page";

export const metadata: Metadata = { title: "Contacts — Wax" };

export default function ContactsPage() {
  return <DeskPage tab="contacts" />;
}

// Reads the session and the database on every request.
export const instant = false;
