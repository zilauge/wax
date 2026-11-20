'use client';

import React, { useActionState, useState } from 'react';
import Link from 'next/link';
import AuthShell, { SocialButtons } from './shell';
import { signInAction, type AuthState } from '../lib/auth-actions';
import { ArrowRightIcon, EyeIcon, LockIcon, MailIcon } from './icons';

const INITIAL_STATE: AuthState = {};

export default function Login() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    INITIAL_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Enter your credentials to access your workspace"
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

        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="block text-xs font-medium uppercase tracking-wider text-slate-400"
          >
            Email Address
          </label>
          <div className="group relative">
            <MailIcon className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-indigo-400" />
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="block w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pr-4 pl-11 text-sm text-white placeholder-slate-500 transition-all focus:border-indigo-500/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="block text-xs font-medium uppercase tracking-wider text-slate-400"
          >
            Password
          </label>
          <div className="group relative">
            <LockIcon className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-indigo-400" />
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
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

        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-400">
          <input
            name="rememberMe"
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-indigo-500 [color-scheme:dark]"
          />
          Keep me signed in for 30 days
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
              <span>Sign In</span>
              <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </button>

        <SocialButtons />

        <p className="text-center text-sm text-slate-400">
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            className="font-medium text-indigo-400 transition-colors hover:text-indigo-300"
          >
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
