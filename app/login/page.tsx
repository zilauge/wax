import type { Metadata } from "next";
import Login from "@/app/components/auth/login";

export const metadata: Metadata = {
  title: "Sign in — Wax",
  description: "Sign in to your Wax omnichannel workspace.",
};

export default function LoginPage() {
  return <Login />;
}
