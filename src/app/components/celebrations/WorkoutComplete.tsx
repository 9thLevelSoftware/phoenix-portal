import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Clock, Dumbbell, Flame, TrendingUp } from 'lucide-react';

interface WorkoutCompleteProps {
  isOpen: boolean;
  onClose: () => void;
  duration: string;
  volume: string;
  prsAchieved: number;
  streakContinued?: boolean;
  onViewSummary: () => void;
}

export function WorkoutComplete({
  isOpen,
  onClose,
  duration,
  volume,
  prsAchieved,
  streakContinued = false,
  onViewSummary,
}: WorkoutCompleteProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setPhase(0);
      return;
    }

    const timers = [
      setTimeout(() => setPhase(1), 200), // Checkmark draw
      setTimeout(() => setPhase(2), 800), // Stats card
    ];

    return () => timers.forEach(clearTimeout);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Semi-transparent Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />

          {/* Checkmark Draw Animation */}
          <AnimatePresence>
            {phase >= 1 && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', duration: 0.6 }}
                className="fixed left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 z-[101]"
              >
                <svg width="120" height="120" viewBox="0 0 120 120" className="drop-shadow-2xl">
                  {/* Outer circle */}
                  <motion.circle
                    cx="60"
                    cy="60"
                    r="54"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="4"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.6, ease: 'easeInOut' }}
                  />

                  {/* Checkmark path */}
                  <motion.path
                    d="M 35 60 L 52 75 L 85 42"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, delay: 0.3, ease: 'easeOut' }}
                  />

                  {/* Ember outline glow */}
                  <motion.circle
                    cx="60"
                    cy="60"
                    r="54"
                    fill="none"
                    stroke="#FF6B35"
                    strokeWidth="2"
                    opacity="0.4"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 0.4 }}
                    transition={{ duration: 0.4, delay: 0.5 }}
                  />
                </svg>

                {/* Particle burst on completion */}
                <ParticleBurst count={30} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Stats Card */}
          <AnimatePresence>
            {phase >= 2 && (
              <motion.div
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0 }}
                transition={{ type: 'spring', damping: 20 }}
                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[102] w-full max-w-md px-4"
              >
                <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-2 border-[#10B981] overflow-hidden relative">
                  {/* Glow effect */}
                  <motion.div
                    className="absolute inset-0 bg-[#10B981]/10 blur-xl"
                    animate={{
                      opacity: [0.3, 0.5, 0.3],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />

                  <div className="relative z-10">
                    {/* Title */}
                    <motion.div
                      className="text-center mb-6"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                    >
                      <div className="text-3xl font-bold text-white mb-2">
                        ✓ Workout Complete
                      </div>
                      <p className="text-sm text-[#10B981]">Great work! Keep the momentum going! 🔥</p>
                    </motion.div>

                    {/* Stats Grid */}
                    <motion.div
                      className="grid grid-cols-1 gap-3 mb-6"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      <div className="flex items-center gap-3 p-3 bg-[#0D0D0D] rounded-lg border border-[#374151]">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366F1] to-[#4F46E5] flex items-center justify-center">
                          <Clock className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="text-xs text-[#9CA3AF]">Duration</div>
                          <div className="text-lg font-bold text-white">{duration}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-[#0D0D0D] rounded-lg border border-[#374151]">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#10B981] to-[#059669] flex items-center justify-center">
                          <Dumbbell className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="text-xs text-[#9CA3AF]">Total Volume</div>
                          <div className="text-lg font-bold text-white">{volume}</div>
                        </div>
                      </div>

                      {prsAchieved > 0 && (
                        <motion.div
                          className="flex items-center gap-3 p-3 bg-gradient-to-br from-[#F59E0B]/20 to-[#D97706]/10 rounded-lg border-2 border-[#F59E0B]"
                          initial={{ scale: 0.9 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: 0.3, type: 'spring' }}
                        >
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#F59E0B] to-[#D97706] flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1">
                            <div className="text-xs text-[#F59E0B] font-semibold">PRs Achieved</div>
                            <div className="text-lg font-bold text-white">{prsAchieved} 🔥</div>
                          </div>
                          <motion.div
                            className="text-2xl"
                            animate={{
                              scale: [1, 1.2, 1],
                            }}
                            transition={{
                              duration: 1,
                              repeat: Infinity,
                              ease: 'easeInOut',
                            }}
                          >
                            🏆
                          </motion.div>
                        </motion.div>
                      )}

                      {streakContinued && (
                        <motion.div
                          className="flex items-center gap-3 p-3 bg-gradient-to-br from-[#FF6B35]/20 to-[#DC2626]/10 rounded-lg border border-[#FF6B35]"
                          initial={{ scale: 0.9 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: 0.4, type: 'spring' }}
                        >
                          <motion.div
                            animate={{
                              scale: [1, 1.1, 1],
                            }}
                            transition={{
                              duration: 1.5,
                              repeat: Infinity,
                              ease: 'easeInOut',
                            }}
                          >
                            <Flame className="w-10 h-10 text-[#FF6B35]" fill="#FF6B35" />
                          </motion.div>
                          <div className="flex-1">
                            <div className="text-xs text-[#FF6B35] font-semibold">Streak Continued!</div>
                            <div className="text-sm text-white">Keep the fire burning 🔥</div>
                          </div>
                        </motion.div>
                      )}
                    </motion.div>

                    {/* Action Buttons */}
                    <motion.div
                      className="flex gap-3"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                    >
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewSummary();
                        }}
                        className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
                      >
                        View Summary
                      </Button>
                      <Button
                        onClick={onClose}
                        variant="outline"
                        className="flex-1 border-[#374151] hover:border-[#FF6B35]"
                      >
                        Done
                      </Button>
                    </motion.div>

                    <p className="text-xs text-center text-[#6B7280] mt-4">
                      Tap anywhere to dismiss
                    </p>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Background Ember Particles */}
          <AnimatePresence>
            {phase >= 2 && <BackgroundEmbers />}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}

function ParticleBurst({ count }: { count: number }) {
  const particles = Array.from({ length: count });

  return (
    <>
      {particles.map((_, i) => {
        const angle = (Math.PI * 2 * i) / particles.length;
        const distance = 80 + Math.random() * 40;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance;

        return (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-[#10B981]"
            style={{
              left: '50%',
              top: '50%',
              boxShadow: '0 0 8px rgba(16, 185, 129, 0.8)',
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x,
              y,
              opacity: 0,
              scale: 0,
            }}
            transition={{
              duration: 0.8,
              ease: 'easeOut',
            }}
          />
        );
      })}
    </>
  );
}

function BackgroundEmbers() {
  const particles = Array.from({ length: 20 });

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none overflow-hidden">
      {particles.map((_, i) => {
        const startX = Math.random() * window.innerWidth;
        const drift = (Math.random() - 0.5) * 100;

        return (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-[#FF6B35]"
            style={{
              left: startX,
              bottom: 0,
              boxShadow: '0 0 8px rgba(255, 107, 53, 0.6)',
            }}
            initial={{ y: 0, opacity: 0.8, scale: 1 }}
            animate={{
              y: [-50, -200, -400],
              x: [0, drift, drift * 1.5],
              opacity: [0.8, 0.4, 0],
              scale: [1, 0.8, 0],
            }}
            transition={{
              duration: 3 + Math.random() * 2,
              delay: Math.random() * 2,
              ease: 'easeOut',
              repeat: Infinity,
            }}
          />
        );
      })}
    </div>
  );
}
