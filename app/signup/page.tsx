import type { Metadata } from "next";
import Signup from "@/app/components/auth/signup";

export const metadata: Metadata = {
  title: "Create account — Wax",
  description: "Create your Wax omnichannel workspace.",
};

export default function SignupPage() {
  return <Signup />;
}
