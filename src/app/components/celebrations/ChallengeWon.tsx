import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/app/components/ui/button';
import { Trophy, ExternalLink } from 'lucide-react';
import { Podium } from './challenge-won/Podium';
import { ConfettiEffect } from './challenge-won/ConfettiEffect';
import { Spotlight } from './challenge-won/Spotlight';
import { RewardsCard } from './challenge-won/RewardsCard';
import { ChallengeWonProps, PLACEMENT_CONFIG } from './challenge-won/types';

export function ChallengeWon({
  placement,
  challengeName,
  challengeType = 'Challenge',
  userAvatar = 'YO',
  rewards,
  onDismiss,
  onViewResults,
}: ChallengeWonProps) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [animationPhase, setAnimationPhase] = useState(0);

  const config = PLACEMENT_CONFIG[placement];

  useEffect(() => {
    // Phase timing
    const timers = [
      setTimeout(() => setAnimationPhase(1), 1200), // Avatar drops
      setTimeout(() => {
        setAnimationPhase(2);
        setShowConfetti(true);
      }, 2000), // Rank reveal + confetti
      setTimeout(() => setAnimationPhase(3), 2800), // Banner + rewards
    ];

    return () => timers.forEach(clearTimeout);
  }, []);

  // Calculate avatar position based on placement
  const getAvatarPosition = () => {
    switch (placement) {
      case 1:
        return 'left-1/2 -translate-x-1/2'; // Center
      case 2:
        return 'left-[calc(50%-150px+45px)]'; // Left position
      case 3:
        return 'left-[calc(50%+105px)]'; // Right position
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        onClick={onDismiss}
        className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(13,13,13,0.95)] overflow-hidden"
      >
        {/* Spotlight (1st place only) */}
        {placement === 1 && <Spotlight />}

        {/* Confetti */}
        <ConfettiEffect colors={config.confettiColors} count={config.confettiCount} trigger={showConfetti} />

        {/* Main content */}
        <div className="relative w-full h-full flex flex-col items-center justify-center px-4">
          {/* Banner - Phase 4 */}
          {animationPhase >= 3 && (
            <motion.div
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{
                type: 'spring',
                damping: 20,
                delay: 0.2,
              }}
              className="absolute top-8 md:top-16 left-0 right-0 text-center z-10"
            >
              {/* Decorative lines */}
              <div className="flex items-center justify-center gap-4 mb-2">
                <div className="h-px w-16 md:w-32 bg-gradient-to-r from-transparent to-[#FF6B35]" />
                <motion.div
                  animate={{
                    scale: [1, 1.1, 1],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="flex items-center gap-2"
                >
                  <Trophy className="w-6 h-6 md:w-8 md:h-8 text-[#F59E0B]" />
                  <h2 className="text-2xl md:text-4xl font-bold text-white">CHALLENGE COMPLETE!</h2>
                  <Trophy className="w-6 h-6 md:w-8 md:h-8 text-[#F59E0B]" />
                </motion.div>
                <div className="h-px w-16 md:w-32 bg-gradient-to-l from-transparent to-[#FF6B35]" />
              </div>

              {/* Challenge name */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-lg md:text-xl text-[#E5E7EB] mt-2"
              >
                {challengeName}
              </motion.p>
            </motion.div>
          )}

          {/* Podium and Avatar area */}
          <div className="relative flex flex-col items-center justify-center mb-8">
            {/* Avatar - Phase 2 */}
            {animationPhase >= 1 && (
              <motion.div
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{
                  type: 'spring',
                  damping: 10,
                  stiffness: 200,
                }}
                className={`absolute ${getAvatarPosition()} z-20`}
                style={{ top: placement === 1 ? '-80px' : '-60px' }}
              >
                {/* Rank icon - Phase 3 */}
                {animationPhase >= 2 && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: 'spring',
                      damping: 15,
                    }}
                    className="absolute -top-12 left-1/2 -translate-x-1/2 text-4xl md:text-5xl"
                  >
                    {config.icon}
                  </motion.div>
                )}

                {/* Avatar */}
                <div
                  className="w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center text-xl md:text-2xl font-bold text-white ring-4"
                  style={{
                    background: config.bgGradient,
                    ringColor: config.color,
                  }}
                >
                  {userAvatar}
                </div>

                {/* Rank label - Phase 3 */}
                {animationPhase >= 2 && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: 'spring',
                      damping: 15,
                      delay: 0.1,
                    }}
                    className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-2"
                  >
                    <span className="text-2xl">✨</span>
                    <span
                      className={`text-3xl md:text-4xl font-bold bg-gradient-to-r ${config.gradient} bg-clip-text text-transparent`}
                      style={{
                        textShadow: `0 0 20px ${config.color}80`,
                      }}
                    >
                      {config.label}
                    </span>
                    <span className="text-2xl">✨</span>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* Podium - Phase 1 */}
            <Podium userPlacement={placement} />
          </div>

          {/* Rewards Card - Phase 4 */}
          {animationPhase >= 3 && rewards.length > 0 && <RewardsCard rewards={rewards} />}

          {/* Actions - Phase 4 */}
          {animationPhase >= 3 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 3.5 }}
              className="absolute bottom-8 md:bottom-16 left-0 right-0 flex flex-col items-center gap-4"
            >
              {onViewResults && (
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewResults();
                  }}
                  variant="outline"
                  className="border-[#FF6B35] text-[#FF6B35] hover:bg-[#FF6B35]/10"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Full Results
                </Button>
              )}

              <p className="text-sm text-[#6B7280]">Tap anywhere to dismiss</p>
            </motion.div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
