import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, todayIn, type OpOutput, type Permission, type Role } from '@rgk/core';
import { api, backend } from './api';
import { ApiError, type Session } from './backend';

export type Me = OpOutput<'me.get'>;

interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in' | 'blocked';
  session: Session | null;
  me: Me | null;
  error: ApiError | null;
  refresh: () => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const qc = useQueryClient();

  useEffect(() => backend().onAuthChange((s) => {
    setSession(s);
    if (!s) qc.clear();
  }), [qc]);

  const meQuery = useQuery<Me, ApiError>({
    queryKey: ['me.get', session?.uid],
    queryFn: () => api('me.get', {}),
    enabled: !!session,
    retry: (count, e) => e.code !== 'permission-denied' && e.code !== 'unauthenticated' && count < 2,
    staleTime: 5 * 60_000,
  });

  const value: SessionState = (() => {
    const base = {
      session: session ?? null,
      refresh: () => void meQuery.refetch(),
      signOut: async () => {
        await backend().signOut();
        qc.clear();
      },
    };
    if (session === undefined) return { ...base, status: 'loading', me: null, error: null };
    if (!session) return { ...base, status: 'signed-out', me: null, error: null };
    if (meQuery.error) return { ...base, status: 'blocked', me: null, error: meQuery.error };
    if (!meQuery.data) return { ...base, status: 'loading', me: null, error: null };
    return { ...base, status: 'signed-in', me: meQuery.data, error: null };
  })();

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** The signed-in user's profile. Only call inside authenticated routes. */
export function useMe(): Me & { role: Role; can: (p: Permission) => boolean; today: string } {
  const { me } = useSession();
  if (!me) throw new Error('useMe requires a signed-in user');
  return {
    ...me,
    role: me.user.role,
    can: (p: Permission) => can(me.user.role, p),
    today: todayIn(me.settings.timezone, new Date()),
  };
}
