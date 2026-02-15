import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from './keys';
import { routineListSchema } from '@/schemas/transforms';

export function routineListOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.routines.byUser(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routines')
        .select('*')
        .eq('user_id', userId)
        .order('last_used_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return routineListSchema.parse(data);
    },
  });
}
