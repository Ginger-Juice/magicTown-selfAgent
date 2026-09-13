import { useCallback, useRef } from 'react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/providers/auth';

/** Best-effort: a missed stamp must never block opening a landmark. */
export function useRecordLandmark() {
  const { user } = useAuth();
  const record = trpc.trail.record.useMutation();
  const mutate = useRef(record.mutate);
  mutate.current = record.mutate;

  return useCallback(
    (landmarkId: string) => {
      if (!user) return;
      mutate.current({ kind: 'open_landmark', landmarkId });
    },
    [user],
  );
}
