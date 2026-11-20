"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/app/lib/auth/auth";
import { db } from "@/app/lib/db/db";
import {
  checkLoginThrottle,
  clearLoginFailures,
  clientIpFrom,
  recordFailedLogin,
} from "@/app/lib/auth/login-throttle";
import { provisionWorkspace } from "@/app/lib/workspace/seed";
import { normalizePhone } from "@/app/lib/auth/phone";

export type AuthState = { error?: string };

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export async function signInAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("rememberMe") === "on";

  if (!email || !password) {
    return { error: "Please enter both your email and password." };
  }

  const ip = clientIpFrom(await headers());
  const throttle = checkLoginThrottle(email, ip);
  if (throttle.locked) {
    return {
      error: `Too many sign-in attempts. Try again in ${throttle.retryAfterSeconds}s.`,
    };
  }

  const user = db
    .prepare(
      "SELECT id, password_hash, password_salt FROM users WHERE email = ?",
    )
    .get(email);

  if (
    !user ||
    !verifyPassword(
      password,
      String(user.password_hash),
      String(user.password_salt),
    )
  ) {
    const failure = recordFailedLogin(email, ip);
    if (failure.locked) {
      return {
        error: `Too many sign-in attempts. Try again in ${failure.retryAfterSeconds}s.`,
      };
    }
    return { error: "That email and password combination is not valid." };
  }

  const membership = db
    .prepare(
      "SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY rowid LIMIT 1",
    )
    .get(String(user.id));

  if (!membership) {
    return { error: "This account is not attached to a workspace." };
  }

  clearLoginFailures(email);
  await createSession(String(user.id), String(membership.workspace_id), remember);
  redirect("/inbox");
}

export async function signUpAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phoneInput = String(formData.get("phone") ?? "").trim();
  const phone = normalizePhone(phoneInput);
  const password = String(formData.get("password") ?? "");
  const acceptedTerms = formData.get("acceptedTerms") === "on";

  if (!name || !email || !password) {
    return { error: "Please fill in your name, email and password." };
  }
  if (!phone) {
    return {
      error:
        "Enter a mobile number in international format, for example +14155550134.",
    };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Please enter a valid work email address." };
  }
  if (password.length < 8) {
    return { error: "Your password needs at least 8 characters." };
  }
  if (!acceptedTerms) {
    return { error: "Please accept the terms to create your account." };
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email);

  if (existing) {
    return { error: "An account with that email already exists. Sign in instead." };
  }

  const userId = randomUUID();
  const { hash, salt } = hashPassword(password);

  db.prepare(
    `INSERT INTO users (id, email, name, company, password_hash, password_salt, phone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, email, name, company, hash, salt, phone, Date.now());

  const workspaceId = provisionWorkspace({
    userId,
    userName: name,
    companyName: company,
  });

  await createSession(userId, workspaceId, false);
  // New accounts land on onboarding: verify the mobile number, then link feeds.
  redirect("/connect");
}

export async function signOutAction() {
  await destroySession();
  redirect("/login");
}
