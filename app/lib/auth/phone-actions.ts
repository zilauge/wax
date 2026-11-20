"use server";

import { requireUser } from "@/app/lib/auth/auth";
import {
  confirmPhoneCode,
  startPhoneVerification,
  type SendCodeResult,
  type VerifyCodeResult,
} from "@/app/lib/auth/phone";

export async function sendPhoneCodeAction(
  phone: string,
): Promise<SendCodeResult> {
  const user = await requireUser();
  return startPhoneVerification(user.id, phone);
}

export async function verifyPhoneCodeAction(
  code: string,
): Promise<VerifyCodeResult> {
  const user = await requireUser();
  return confirmPhoneCode(user.id, code);
}
