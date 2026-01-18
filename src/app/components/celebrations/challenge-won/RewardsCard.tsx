import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Trophy, Zap, Star, Award } from 'lucide-react';
import { ChallengeReward } from './types';

interface RewardsCardProps {
  rewards: ChallengeReward[];
}

export function RewardsCard({ rewards }: RewardsCardProps) {
  const getRewardIcon = (reward: ChallengeReward) => {
    if (reward.icon) {
      return <span className="text-2xl">{reward.icon}</span>;
    }

    switch (reward.type) {
      case 'badge':
        return <Award className="w-6 h-6 text-[#F59E0B]" />;
      case 'premium':
        return <Zap className="w-6 h-6 text-[#FBBF24]" />;
      case 'points':
        return <Star className="w-6 h-6 text-[#FF6B35]" />;
      case 'title':
        return <Trophy className="w-6 h-6 text-[#10B981]" />;
      default:
        return <Trophy className="w-6 h-6 text-[#9CA3AF]" />;
    }
  };

  return (
    <motion.div
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        type: 'spring',
        damping: 20,
        delay: 3.0,
      }}
      className="w-full max-w-md mx-auto px-4"
    >
      <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
        <h3 className="text-lg font-semibold text-white mb-4 text-center">REWARDS EARNED</h3>

        <div className="space-y-3">
          {rewards.map((reward, index) => (
            <motion.div
              key={index}
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{
                delay: 3.2 + index * 0.1,
                type: 'spring',
                damping: 20,
              }}
              className="flex items-center gap-3 p-3 bg-[#0D0D0D] rounded-lg border border-[#374151]"
            >
              <div className="flex-shrink-0">{getRewardIcon(reward)}</div>
              <div className="flex-1">
                <p className="text-white font-medium">{reward.name}</p>
                <p className="text-xs text-[#6B7280] capitalize">{reward.type}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}
