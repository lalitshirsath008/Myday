import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { OpInput, OpName, OpOutput } from '@rgk/core';
import { toast } from 'sonner';
import { ApiError, type Backend } from './backend';

let current: Backend | null = null;

export function setBackend(b: Backend) {
  current = b;
}

export function backend(): Backend {
  if (!current) throw new Error('Backend not initialised');
  return current;
}

/** Typed call to a server operation. */
export function api<K extends OpName>(op: K, input: OpInput<K>): Promise<OpOutput<K>> {
  return backend().call(op, input) as Promise<OpOutput<K>>;
}

export function useOp<K extends OpName>(
  op: K,
  input: OpInput<K>,
  options: Omit<UseQueryOptions<OpOutput<K>, ApiError>, 'queryKey' | 'queryFn'> = {},
) {
  return useQuery<OpOutput<K>, ApiError>({ queryKey: [op, input], queryFn: () => api(op, input), ...options });
}

/**
 * Mutation for an operation. `invalidate` lists operation names whose cached results become stale.
 * Errors are shown as toasts unless `silent` is set (forms that show inline errors set it).
 */
export function useOpMutation<K extends OpName>(op: K, opts: { invalidate?: OpName[]; success?: string | ((r: OpOutput<K>) => string); silent?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation<OpOutput<K>, ApiError, OpInput<K>>({
    mutationFn: (input) => api(op, input),
    onSuccess: async (result) => {
      await Promise.all((opts.invalidate ?? []).map((name) => qc.invalidateQueries({ queryKey: [name] })));
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(result) : opts.success);
    },
    onError: (e) => {
      if (!opts.silent) toast.error(e.message);
    },
  });
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
