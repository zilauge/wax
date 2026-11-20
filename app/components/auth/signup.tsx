'use client';

import React, { useActionState, useState } from 'react';
import Link from 'next/link';
import AuthShell, { SocialButtons } from './shell';
import { signUpAction, type AuthState } from '@/app/lib/auth/actions';
import { ArrowRightIcon, EyeIcon, LockIcon, MailIcon, UserIcon } from '@/app/components/auth/icons';
import { PhoneIcon } from '@/app/components/shared/icons';

const INITIAL_STATE: AuthState = {};

const fieldClass =
  'block w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pr-4 pl-11 text-sm text-white placeholder-slate-500 transition-all focus:border-indigo-500/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-indigo-500/20 focus:outline-none';
const labelClass =
  'block text-xs font-medium uppercase tracking-wider text-slate-400';
const iconClass =
  'pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-indigo-400';

export default function Signup() {
  const [state, formAction, pending] = useActionState(
    signUpAction,
    INITIAL_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Bring calls, meetings and every social channel together"
    >
      <form action={formAction} className="space-y-5" noValidate>
        {state.error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
          >
            {state.error}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="name" className={labelClass}>
              Full name
            </label>
            <div className="group relative">
              <UserIcon className={iconClass} />
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={fieldClass}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="company" className={labelClass}>
              Company
            </label>
            <div className="group relative">
              <UserIcon className={iconClass} />
              <input
                id="company"
                name="company"
                type="text"
                autoComplete="organization"
                placeholder="Acme Inc."
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                className={fieldClass}
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="email" className={labelClass}>
            Work email
          </label>
          <div className="group relative">
            <MailIcon className={iconClass} />
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldClass}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="phone" className={labelClass}>
            Mobile number
          </label>
          <div className="group relative">
            <PhoneIcon className={iconClass} />
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+14155550134"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={fieldClass}
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Used for calls. We&apos;ll text a six-digit code to verify it next.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <div className="group relative">
            <LockIcon className={iconClass} />
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="block w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pr-11 pl-11 text-sm text-white placeholder-slate-500 transition-all focus:border-indigo-500/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((previous) => !previous)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute top-1/2 right-3.5 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-300"
            >
              <EyeIcon className="h-5 w-5" off={showPassword} />
            </button>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-400">
          <input
            name="acceptedTerms"
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-500 [color-scheme:dark]"
          />
          <span>I agree to the Terms of Service and Privacy Policy.</span>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <>
              <span>Create account</span>
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </button>

        <SocialButtons />

        <p className="text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-indigo-400 transition-colors hover:text-indigo-300"
          >
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
