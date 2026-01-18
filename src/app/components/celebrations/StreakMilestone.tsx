import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Flame } from 'lucide-react';

interface StreakMilestoneProps {
  isOpen: boolean;
  onClose: () => void;
  streak: number;
}

const milestoneMessages: Record<number, string> = {
  7: '🔥 One Week Strong!',
  14: '🔥🔥 Two Weeks of Fire!',
  30: '🔥🔥🔥 Monthly Warrior!',
  60: '🌟 Two Month Legend!',
  90: '⚡ Quarter Year Champion!',
  180: '👑 Half Year Royalty!',
  365: '🏆 PHOENIX IMMORTAL',
};

export function StreakMilestone({ isOpen, onClose, streak }: StreakMilestoneProps) {
  const [phase, setPhase] = useState(0);
  const isYearMilestone = streak === 365;

  useEffect(() => {
    if (!isOpen) {
      setPhase(0);
      return;
    }

    const timers = [
      setTimeout(() => setPhase(1), 300), // Flame intensify
      setTimeout(() => setPhase(2), 800), // Number reveal
      setTimeout(() => setPhase(3), 1500), // Ring expansion
      setTimeout(() => setPhase(4), 2200), // Achievement card
      setTimeout(() => {
        if (!isYearMilestone) {
          setPhase(5); // Auto-dismiss for non-year milestones
        }
      }, 4200),
    ];

    return () => timers.forEach(clearTimeout);
  }, [isOpen, isYearMilestone]);

  const handleDismiss = () => {
    setPhase(0);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Dark Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleDismiss}
            className="fixed inset-0 bg-black/90 z-[100]"
          />

          {/* Flame Icon - Intensify */}
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101]">
            <motion.div
              initial={{ scale: 1, filter: 'drop-shadow(0 0 10px #FF6B35)' }}
              animate={
                phase >= 1
                  ? {
                      scale: isYearMilestone ? 4 : 3,
                      filter: [
                        'drop-shadow(0 0 20px #FF6B35)',
                        'drop-shadow(0 0 60px #DC2626)',
                        'drop-shadow(0 0 40px #F59E0B)',
                      ],
                    }
                  : {}
              }
              transition={{
                duration: 0.8,
                filter: {
                  duration: 1.5,
                  repeat: Infinity,
                  repeatType: 'reverse',
                },
              }}
            >
              <Flame className="w-24 h-24 text-[#FF6B35]" fill="#FF6B35" />
            </motion.div>

            {/* Milestone Number */}
            <AnimatePresence>
              {phase >= 2 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -z-10"
                >
                  <div
                    className="text-[12rem] font-bold bg-gradient-to-br from-[#FF6B35] to-[#DC2626] bg-clip-text text-transparent"
                    style={{
                      filter: 'drop-shadow(0 0 30px rgba(255, 107, 53, 0.5))',
                    }}
                  >
                    {streak}
                  </div>
                  <div className="text-3xl font-semibold text-center text-[#F59E0B] uppercase tracking-wider mt-4">
                    Day Streak!
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Ring Expansion */}
          <AnimatePresence>
            {phase >= 3 &&
              [0, 1, 2].map((index) => (
                <motion.div
                  key={index}
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[#FF6B35] z-[100]"
                  initial={{ scale: 0, opacity: 0.8 }}
                  animate={{ scale: 3, opacity: 0 }}
                  transition={{
                    duration: 1.5,
                    delay: index * 0.2,
                    ease: 'easeOut',
                  }}
                  style={{
                    width: 200,
                    height: 200,
                  }}
                />
              ))}
          </AnimatePresence>

          {/* Ember Particles */}
          <AnimatePresence>
            {phase >= 3 && <EmberParticles count={isYearMilestone ? 100 : 50} />}
          </AnimatePresence>

          {/* Achievement Card */}
          <AnimatePresence>
            {phase >= 4 && (
              <motion.div
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -100, opacity: 0 }}
                transition={{ type: 'spring', damping: 15 }}
                className="fixed left-1/2 top-24 -translate-x-1/2 z-[102] w-full max-w-md px-4"
                onClick={handleDismiss}
              >
                <Card
                  className={`p-6 text-center ${
                    isYearMilestone
                      ? 'bg-gradient-to-br from-[#F59E0B] to-[#DC2626] border-[#F59E0B]'
                      : 'bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#FF6B35]'
                  } border-2 overflow-hidden relative`}
                >
                  {/* Shimmer effect for year milestone */}
                  {isYearMilestone && (
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                      animate={{
                        x: ['-100%', '100%'],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: 'linear',
                      }}
                    />
                  )}

                  <div className="relative z-10">
                    <motion.h2
                      className={`text-2xl font-bold mb-2 ${
                        isYearMilestone ? 'text-white' : 'text-[#FF6B35]'
                      }`}
                      animate={isYearMilestone ? { scale: [1, 1.05, 1] } : {}}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      {milestoneMessages[streak] || `${streak} Day Streak!`}
                    </motion.h2>

                    {isYearMilestone && (
                      <motion.p
                        className="text-white/90 text-sm mb-4"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.5 }}
                      >
                        One Full Year of Dedication!
                      </motion.p>
                    )}

                    <p
                      className={`text-xs ${isYearMilestone ? 'text-white/70' : 'text-[#6B7280]'} mt-4`}
                    >
                      {phase >= 5 || isYearMilestone ? 'Tap to continue' : 'Keep the fire burning! 🔥'}
                    </p>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}

function EmberParticles({ count }: { count: number }) {
  const particles = Array.from({ length: count });

  return (
    <div className="fixed inset-0 z-[101] pointer-events-none overflow-hidden">
      {particles.map((_, i) => {
        const startX = Math.random() * window.innerWidth;
        const drift = (Math.random() - 0.5) * 100;

        return (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-[#FF6B35]"
            style={{
              left: startX,
              top: '50%',
              boxShadow: '0 0 8px rgba(255, 107, 53, 0.8)',
            }}
            initial={{ y: 0, opacity: 1, scale: 1 }}
            animate={{
              y: [-100, -300, -500],
              x: [0, drift, drift * 2],
              opacity: [1, 0.6, 0],
              scale: [1, 0.8, 0],
            }}
            transition={{
              duration: 2 + Math.random() * 2,
              delay: Math.random() * 0.5,
              ease: 'easeOut',
            }}
          />
        );
      })}
    </div>
  );
}
