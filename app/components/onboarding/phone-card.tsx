"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  sendPhoneCodeAction,
  verifyPhoneCodeAction,
} from "@/app/lib/auth/phone-actions";

/**
 * The mobile number is the one used for calls. It is verified with a six-digit
 * one-time code, and the code is only ever sent to the number on the account.
 */
export default function PhoneCard({
  phone,
  verified,
}: {
  phone: string | null;
  verified: boolean;
}) {
  const router = useRouter();
  const [number, setNumber] = useState(phone ?? "");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode() {
    setError(null);
    setNotice(null);
    setBusy("send");
    const result = await sendPhoneCodeAction(number);
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSentTo(result.phone);
    setNotice(
      result.channel === "console"
        ? "Development mode: the code was printed in the server console."
        : `Code sent to ${result.phone}.`,
    );
  }

  async function verifyCode() {
    setError(null);
    setNotice(null);
    setBusy("verify");
    const result = await verifyPhoneCodeAction(code);
    setBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setCode("");
    setNotice(`${result.phone} verified.`);
    router.refresh();
  }

  return (
    <section className="px-4 py-3">
      <div className="flex items-center justify-between pb-2">
        <p className="wax-eyebrow">
          Mobile number
        </p>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            verified
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
              : "border-amber-400/25 bg-amber-400/10 text-amber-300"
          }`}
        >
          {verified ? "Verified" : "Not verified"}
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-label="Mobile number"
          placeholder="+14155550134"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-fg/[0.08] bg-fg/[0.03] px-3 py-2 text-xs text-fg outline-none transition-colors placeholder:text-slate-500 focus:border-indigo-400/50 focus:bg-fg/[0.05]"
        />
        <button
          type="button"
          disabled={busy === "send"}
          onClick={sendCode}
          className="wax-press inline-flex items-center rounded-lg border border-fg/[0.09] bg-fg/[0.035] px-3 py-2 text-[11px] font-semibold text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:border-fg/[0.16] hover:bg-fg/[0.075] hover:text-fg disabled:opacity-60"
        >
          {busy === "send" ? "Sending…" : sentTo ? "Resend code" : "Send code"}
        </button>
      </div>

      {sentTo && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            aria-label="Six-digit verification code"
            placeholder="Six-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className="w-36 rounded-lg border border-fg/[0.08] bg-fg/[0.03] px-3 py-2 font-mono text-xs tracking-[0.2em] text-fg outline-none transition-colors placeholder:text-slate-500 focus:border-indigo-400/50 focus:bg-fg/[0.05]"
          />
          <button
            type="button"
            disabled={busy === "verify" || code.length !== 6}
            onClick={verifyCode}
            className="wax-press wax-sheen inline-flex items-center rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-3 py-2 text-[11px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors hover:from-indigo-400 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "verify" ? "Checking…" : "Verify"}
          </button>
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        Use international format. Calls route to this number once it is verified;
        without a configured SMS provider the code appears in the server log in
        development and is refused in production.
      </p>
    </section>
  );
}
