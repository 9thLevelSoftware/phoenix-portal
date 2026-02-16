import { useQuery } from '@tanstack/react-query';
import { Avatar, AvatarFallback, AvatarImage } from '@/app/components/ui/avatar';
import { Skeleton } from '@/app/components/ui/skeleton';
import { featuredCreatorsOptions } from '@/queries/community';

interface FeaturedCreatorsProps {
  onSelectCreator: (userId: string) => void;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function FeaturedCreators({ onSelectCreator }: FeaturedCreatorsProps) {
  const { data: creators, isLoading } = useQuery(featuredCreatorsOptions());

  // Hide entire section if no featured creators
  if (!isLoading && (!creators || creators.length === 0)) return null;

  return (
    <div className="mb-6">
      <p className="text-xs text-[#6B7280] uppercase tracking-wider mb-3">
        Featured Creators
      </p>

      <div className="flex gap-3 overflow-x-auto snap-x scrollbar-hide pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5 shrink-0">
                <Skeleton className="w-14 h-14 rounded-full" />
                <Skeleton className="w-12 h-3 rounded" />
              </div>
            ))
          : creators?.map((creator) => (
              <button
                key={creator.user_id}
                onClick={() => onSelectCreator(creator.user_id)}
                className="flex flex-col items-center gap-1.5 shrink-0 snap-start group"
              >
                <div className="ring-2 ring-[#FF6B35]/50 rounded-full p-0.5 group-hover:ring-[#FF6B35] transition-all">
                  <Avatar className="w-12 h-12">
                    {creator.avatar_url && (
                      <AvatarImage src={creator.avatar_url} alt={creator.display_name} />
                    )}
                    <AvatarFallback className="bg-gradient-to-br from-[#FF6B35] to-[#DC2626] text-white text-sm">
                      {getInitials(creator.display_name)}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <span className="text-[11px] text-[#9CA3AF] max-w-16 truncate group-hover:text-white transition-colors">
                  {creator.display_name}
                </span>
              </button>
            ))}
      </div>
    </div>
  );
}
