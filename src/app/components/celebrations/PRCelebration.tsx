import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Flame, TrendingUp, Award } from 'lucide-react';

interface PRCelebrationProps {
  isOpen: boolean;
  onClose: () => void;
  prData: {
    exerciseName: string;
    weight: number;
    reps: number;
    estimated1RM: number;
    improvement: number;
    type: 'weight' | 'volume' | '1rm';
  };
}

export function PRCelebration({ isOpen, onClose, prData }: PRCelebrationProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setPhase(0);
      return;
    }

    const timers = [
      setTimeout(() => setPhase(1), 300), // Phoenix rise
      setTimeout(() => setPhase(2), 1500), // Phoenix burst
      setTimeout(() => setPhase(3), 2000), // Card reveal
      setTimeout(() => setPhase(4), 3000), // Auto-dismiss ready
    ];

    return () => timers.forEach(clearTimeout);
  }, [isOpen]);

  const handleDismiss = () => {
    setPhase(0);
    onClose();
  };

  const getTitle = () => {
    switch (prData.type) {
      case 'weight':
        return '🔥 NEW WEIGHT PR! 🔥';
      case 'volume':
        return '💪 NEW VOLUME PR! 💪';
      case '1rm':
        return '⭐ NEW 1RM ESTIMATE! ⭐';
      default:
        return '🔥 NEW PR! 🔥';
    }
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
            className="fixed inset-0 bg-[#0D0D0D]/95 z-[100] backdrop-blur-sm"
            style={{
              background:
                'radial-gradient(circle at center, rgba(255, 107, 53, 0.1) 0%, rgba(13, 13, 13, 0.95) 70%)',
            }}
          />

          {/* Phoenix Rise Animation */}
          <AnimatePresence>
            {phase >= 1 && phase < 3 && (
              <motion.div
                initial={{ y: '100vh', opacity: 0 }}
                animate={{ y: '50vh', opacity: 1 }}
                exit={{ opacity: 0, scale: 0 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
                className="fixed left-1/2 -translate-x-1/2 z-[101]"
              >
                <PhoenixIcon />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Particle Burst */}
          <AnimatePresence>
            {phase >= 2 && phase < 3 && <ParticleBurst />}
          </AnimatePresence>

          {/* PR Card */}
          <AnimatePresence>
            {phase >= 3 && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: 'spring', duration: 0.5 }}
                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[102] w-full max-w-md px-4"
                onClick={handleDismiss}
              >
                <Card className="relative p-8 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-2 border-[#FF6B35] overflow-hidden">
                  {/* Animated gradient border */}
                  <motion.div
                    className="absolute inset-0 opacity-50"
                    style={{
                      background:
                        'linear-gradient(90deg, #FF6B35, #DC2626, #F59E0B, #FF6B35)',
                      backgroundSize: '200% 100%',
                    }}
                    animate={{
                      backgroundPosition: ['0% 0%', '200% 0%'],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'linear',
                    }}
                  />

                  {/* Pulse glow */}
                  <motion.div
                    className="absolute inset-0 bg-[#FF6B35]/20 blur-xl"
                    animate={{
                      opacity: [0.3, 0.6, 0.3],
                      scale: [1, 1.05, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />

                  <div className="relative z-10 text-center">
                    <h2 className="text-2xl font-bold mb-6 bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                      {getTitle()}
                    </h2>

                    <h3 className="text-xl font-semibold text-white mb-4 uppercase">
                      {prData.exerciseName}
                    </h3>

                    <div className="py-6 mb-4">
                      <motion.div
                        className="text-5xl font-bold text-white mb-2"
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                      >
                        {prData.weight} kg × {prData.reps}
                      </motion.div>

                      <div className="text-lg text-[#9CA3AF] mb-4">
                        Estimated 1RM: <span className="text-[#F59E0B]">~{prData.estimated1RM} kg</span>
                      </div>

                      <div className="flex items-center justify-center gap-2 text-[#10B981]">
                        <TrendingUp className="w-5 h-5" />
                        <span className="text-lg font-semibold">
                          +{prData.improvement} kg from previous PR
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-center gap-2 text-[#F59E0B] mb-4">
                      <Award className="w-5 h-5" />
                      <span className="text-sm">Keep Rising</span>
                      <Award className="w-5 h-5" />
                    </div>

                    <p className="text-xs text-[#6B7280] mt-6">Tap anywhere to continue</p>
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

function PhoenixIcon() {
  return (
    <motion.div
      className="relative"
      animate={{
        x: [0, -10, 10, 0],
      }}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    >
      <motion.div
        className="w-48 h-48"
        style={{
          background: 'linear-gradient(to top, #FF6B35, #DC2626)',
          clipPath:
            'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
        }}
        animate={{
          filter: ['drop-shadow(0 0 20px #FF6B35)', 'drop-shadow(0 0 40px #DC2626)'],
        }}
        transition={{
          duration: 1,
          repeat: Infinity,
          repeatType: 'reverse',
        }}
      />

      {/* Ember trail */}
      {Array.from({ length: 15 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-full bg-[#FF6B35]"
          style={{
            left: '50%',
            top: '100%',
          }}
          initial={{ opacity: 0.8, scale: 1 }}
          animate={{
            y: [0, -100, -200],
            x: [0, Math.random() * 40 - 20, Math.random() * 80 - 40],
            opacity: [0.8, 0.4, 0],
            scale: [1, 0.5, 0],
          }}
          transition={{
            duration: 2,
            delay: i * 0.1,
            repeat: Infinity,
          }}
        />
      ))}
    </motion.div>
  );
}

function ParticleBurst() {
  const particles = Array.from({ length: 100 });
  const colors = ['rgba(255, 107, 53, 0.8)', 'rgba(220, 38, 38, 0.7)', 'rgba(245, 158, 11, 0.9)'];

  return (
    <div className="fixed inset-0 z-[101] pointer-events-none">
      {particles.map((_, i) => {
        const angle = (Math.PI * 2 * i) / particles.length;
        const distance = 300 + Math.random() * 200;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance;

        return (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full"
            style={{
              left: '50%',
              top: '50%',
              backgroundColor: colors[Math.floor(Math.random() * colors.length)],
              boxShadow: `0 0 10px ${colors[Math.floor(Math.random() * colors.length)]}`,
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x,
              y,
              opacity: 0,
              scale: 0,
            }}
            transition={{
              duration: 1 + Math.random() * 0.5,
              ease: 'easeOut',
            }}
          />
        );
      })}
    </div>
  );
}
