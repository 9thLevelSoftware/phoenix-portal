import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { ArrowBigUp, Clock, Dumbbell, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import type { SharedRoutine, SharedCycle, CommunityFeedItem } from '@/schemas/community';

interface CommunityFeedCardProps {
  item: CommunityFeedItem;
  onSelect: (id: string) => void;
  isVoted: boolean;
  onVote: (id: string) => void;
  onAuthorClick?: (userId: string) => void;
}

function isRoutine(item: CommunityFeedItem): item is SharedRoutine {
  return 'exercise_count' in item;
}

export function CommunityFeedCard({ item, onSelect, isVoted, onVote, onAuthorClick }: CommunityFeedCardProps) {
  const authorName = item.profiles?.display_name ?? 'Unknown';
  const sharedAgo = formatDistanceToNow(item.shared_at, { addSuffix: true });

  return (
    <motion.div whileTap={{ scale: 0.98 }}>
      <Card
        onClick={() => onSelect(item.id)}
        className="p-5 bg-[#1A1A2E] border-[#374151] hover:scale-[1.02] hover:shadow-lg hover:shadow-[#FF6B35]/5 transition-all cursor-pointer"
      >
        {/* Header: Author + Vote */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center text-white text-xs shrink-0">
              {authorName.charAt(0).toUpperCase()}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAuthorClick?.(item.user_id);
              }}
              className="text-xs text-[#9CA3AF] truncate hover:text-[#FF6B35] transition-colors"
            >
              {authorName}
            </button>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVote(item.id);
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
              isVoted
                ? 'text-[#FF6B35] bg-[#FF6B35]/10'
                : 'text-[#9CA3AF] hover:text-[#FF6B35] hover:bg-[#FF6B35]/5'
            }`}
          >
            <ArrowBigUp className="w-5 h-5" fill={isVoted ? '#FF6B35' : 'none'} />
            <span className="text-sm font-medium">{item.vote_count}</span>
          </button>
        </div>

        {/* Title */}
        <h3 className="text-white font-semibold mb-2 line-clamp-2">{item.name}</h3>

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {item.tags.slice(0, 4).map((tag) => (
              <Badge
                key={tag}
                className="bg-[#374151] text-[#E5E7EB] border-0 text-[11px] px-2 py-0"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-[#9CA3AF] mb-2">
          {isRoutine(item) ? (
            <>
              <div className="flex items-center gap-1">
                <Dumbbell className="w-3.5 h-3.5" />
                <span>{item.exercise_count} exercises</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>{item.estimated_duration} min</span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>{item.duration_weeks} weeks</span>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <p className="text-[11px] text-[#6B7280]">Shared {sharedAgo}</p>
      </Card>
    </motion.div>
  );
}
