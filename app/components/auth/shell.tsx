import type { ReactNode } from 'react';
import { SparklesIcon } from '@/app/components/auth/icons';

export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen w-full justify-center overflow-hidden bg-slate-950 p-4 py-8 selection:bg-indigo-500/30 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-fuchsia-600/20 blur-[120px]" />
      </div>

      <section className="relative z-10 my-auto h-fit w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur-2xl sm:p-10">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-500/25">
            <SparklesIcon className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {title}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
        </header>
        {children}
      </section>
    </main>
  );
}

export function SocialButtons() {
  return (
    <>
      <div className="relative my-6 flex items-center text-xs uppercase">
        <span className="w-full border-t border-white/10" />
        <span className="shrink-0 px-3 text-slate-500">Or continue with</span>
        <span className="w-full border-t border-white/10" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled
          title="Social sign-in is not configured on this server"
          className="flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-slate-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Google
        </button>

        <button
          type="button"
          disabled
          title="Social sign-in is not configured on this server"
          className="flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-slate-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 2.5a9.5 9.5 0 0 0-3 18.52c.47.08.65-.2.65-.46v-1.8c-2.64.57-3.2-1.13-3.2-1.13-.43-1.1-1.05-1.4-1.05-1.4-.86-.58.07-.57.07-.57.95.07 1.45.98 1.45.98.84 1.44 2.2 1.03 2.74.79.09-.61.33-1.03.6-1.27-2.1-.24-4.32-1.05-4.32-4.68 0-1.04.37-1.88.98-2.55-.1-.24-.42-1.2.09-2.5 0 0 .8-.26 2.62.97a9 9 0 0 1 4.75 0c1.82-1.23 2.62-.97 2.62-.97.51 1.3.19 2.26.1 2.5.6.67.97 1.51.97 2.55 0 3.64-2.22 4.44-4.34 4.67.34.3.64.87.64 1.75v2.6c0 .26.18.55.66.46A9.5 9.5 0 0 0 12 2.5Z"
            />
          </svg>
          GitHub
        </button>
      </div>
    </>
  );
}
