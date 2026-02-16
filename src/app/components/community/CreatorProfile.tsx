import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Avatar, AvatarFallback, AvatarImage } from '@/app/components/ui/avatar';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Skeleton } from '@/app/components/ui/skeleton';
import { ArrowLeft, Share2, ArrowBigUp, Star } from 'lucide-react';
import { creatorStatsOptions, communityFeedOptions } from '@/queries/community';
import { useAuth } from '@/providers/AuthProvider';
import { userVotesOptions } from '@/queries/community';
import { CommunityFeedCard } from '@/app/components/community/CommunityFeedCard';

interface CreatorProfileProps {
  userId: string;
  onBack: () => void;
  onSelectItem?: (id: string) => void;
  onVote?: (id: string) => void;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function CreatorProfile({ userId, onBack, onSelectItem, onVote }: CreatorProfileProps) {
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = useQuery(creatorStatsOptions(userId));

  const {
    data: feedData,
    isLoading: feedLoading,
  } = useInfiniteQuery(
    communityFeedOptions({
      tab: 'routines',
      sort: 'new',
      userId,
    })
  );

  const { data: cycleData } = useInfiniteQuery(
    communityFeedOptions({
      tab: 'cycles',
      sort: 'new',
      userId,
    })
  );

  const { data: votedIds } = useQuery({
    ...userVotesOptions(user?.id ?? ''),
    enabled: !!user?.id,
  });

  const routineItems = feedData?.pages.flat() ?? [];
  const cycleItems = cycleData?.pages.flat() ?? [];
  const allItems = [...routineItems, ...cycleItems];

  return (
    <div>
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="text-[#9CA3AF] hover:text-white mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        Back to feed
      </Button>

      {/* Stats banner */}
      {statsLoading ? (
        <Card className="p-6 bg-[#1A1A2E] border-[#374151] mb-6">
          <div className="flex items-center gap-4">
            <Skeleton className="w-16 h-16 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="w-32 h-5 rounded" />
              <div className="flex gap-4">
                <Skeleton className="w-20 h-10 rounded" />
                <Skeleton className="w-20 h-10 rounded" />
                <Skeleton className="w-20 h-10 rounded" />
              </div>
            </div>
          </div>
        </Card>
      ) : stats ? (
        <Card className="p-6 bg-[#1A1A2E] border-[#374151] mb-6">
          <div className="flex items-center gap-4">
            <Avatar className="w-16 h-16">
              {stats.avatar_url && (
                <AvatarImage src={stats.avatar_url} alt={stats.display_name} />
              )}
              <AvatarFallback className="bg-gradient-to-br from-[#FF6B35] to-[#DC2626] text-white text-lg">
                {getInitials(stats.display_name)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-white mb-3 truncate">
                {stats.display_name}
              </h2>
              <div className="flex gap-4">
                {/* Total Shares */}
                <div className="flex items-center gap-2 bg-[#0D0D0D] rounded-lg px-3 py-2">
                  <Share2 className="w-4 h-4 text-[#FF6B35]" />
                  <div>
                    <p className="text-lg font-bold text-white leading-none">
                      {stats.total_shares}
                    </p>
                    <p className="text-[10px] text-[#6B7280]">Shares</p>
                  </div>
                </div>

                {/* Total Upvotes */}
                <div className="flex items-center gap-2 bg-[#0D0D0D] rounded-lg px-3 py-2">
                  <ArrowBigUp className="w-4 h-4 text-[#F59E0B]" />
                  <div>
                    <p className="text-lg font-bold text-white leading-none">
                      {stats.total_upvotes}
                    </p>
                    <p className="text-[10px] text-[#6B7280]">Upvotes</p>
                  </div>
                </div>

                {/* Featured Count */}
                <div className="flex items-center gap-2 bg-[#0D0D0D] rounded-lg px-3 py-2">
                  <Star className="w-4 h-4 text-[#10B981]" />
                  <div>
                    <p className="text-lg font-bold text-white leading-none">
                      {stats.featured_count}
                    </p>
                    <p className="text-[10px] text-[#6B7280]">Featured</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6 bg-[#1A1A2E] border-[#374151] mb-6">
          <p className="text-[#6B7280]">Creator not found</p>
        </Card>
      )}

      {/* Shared Content */}
      <h3 className="text-sm font-semibold text-[#9CA3AF] uppercase tracking-wider mb-4">
        Shared Content
      </h3>

      {feedLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-5 bg-[#1A1A2E] border-[#374151] animate-pulse h-48" />
          ))}
        </div>
      ) : allItems.length === 0 ? (
        <div className="text-center py-12 text-[#6B7280]">
          <p>This creator has not shared any content yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {allItems.map((item) => (
            <CommunityFeedCard
              key={item.id}
              item={item}
              onSelect={onSelectItem ?? (() => {})}
              isVoted={votedIds?.has(item.id) ?? false}
              onVote={onVote ?? (() => {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}
