import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/queries/keys';

const DEBOUNCE_MS = 2500;

/**
 * Subscribes to Supabase Realtime postgres_changes on the community_votes table.
 * Debounces query invalidation to avoid excessive refetches during vote bursts.
 *
 * @param muted - When true (e.g., during optimistic vote), skip invalidation entirely
 */
export function useCommunityRealtime(muted = false) {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel('community-votes-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'community_votes',
        },
        () => {
          if (muted) return;

          // Clear existing debounce timer
          if (timerRef.current) {
            clearTimeout(timerRef.current);
          }

          // Set new debounced invalidation
          timerRef.current = setTimeout(() => {
            queryClient.invalidateQueries({
              queryKey: queryKeys.community.all,
            });
            timerRef.current = null;
          }, DEBOUNCE_MS);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [queryClient, muted]);
}
