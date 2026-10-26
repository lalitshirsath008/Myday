import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import './index.css';
import { setBackend } from './lib/api';
import { initBackend, type BackendInit } from './lib/backend';
import { SessionProvider } from './lib/session';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (count, e) => !['permission-denied', 'not-found', 'invalid-argument', 'unauthenticated'].includes((e as { code?: string }).code ?? '') && count < 2,
    },
  },
});

function SetupRequired({ reason }: { reason: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold">RGK Myday — setup required</h1>
      <p className="mt-3 text-muted-foreground">{reason}</p>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm">
        <li>Create a Firebase project (Blaze plan, for Cloud Functions) and a Web app in it.</li>
        <li>Copy <code>web/.env.example</code> to <code>web/.env.production.local</code> and fill in the <code>VITE_FIREBASE_*</code> values.</li>
        <li>Deploy functions, rules and indexes, then bootstrap the first Super Admin — see <code>docs/DEPLOYMENT.md</code>.</li>
        <li>Rebuild the web app.</li>
      </ol>
      <p className="mt-6 text-sm text-muted-foreground">This screen appears instead of a fake login so the app never pretends to be connected to a database it cannot reach.</p>
    </main>
  );
}

function Root() {
  const [init, setInit] = useState<BackendInit | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    initBackend()
      .then((r) => {
        if (r.status === 'ready') setBackend(r.backend);
        setInit(r);
      })
      .catch((e: Error) => setFailed(e.message));
  }, []);
  if (failed) return <SetupRequired reason={`The backend could not be initialised: ${failed}`} />;
  if (!init) return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground" role="status">Loading RGK Myday…</div>;
  if (init.status === 'setup-required') return <SetupRequired reason={init.reason} />;
  return <AppWithRouter />;
}

function AppWithRouter() {
  const [router, setRouter] = useState<typeof import('./app/router').router | null>(null);
  useEffect(() => {
    void import('./app/router').then((m) => setRouter(m.router));
  }, []);
  if (!router) return null;
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
      <Toaster richColors closeButton position="top-right" />
    </QueryClientProvider>
  </StrictMode>,
);
