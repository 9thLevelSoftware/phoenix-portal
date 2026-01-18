import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Star, Award, Trophy, Crown } from 'lucide-react';

interface BadgeEarnedProps {
  isOpen: boolean;
  onClose: () => void;
  badgeData: {
    name: string;
    description: string;
    tier: 'bronze' | 'silver' | 'gold' | 'platinum';
    icon: string;
  };
}

export function BadgeEarned({ isOpen, onClose, badgeData }: BadgeEarnedProps) {
  const [phase, setPhase] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPhase(0);
      setIsFlipped(false);
      return;
    }

    const timers = [
      setTimeout(() => setPhase(1), 500), // Card approach
      setTimeout(() => setPhase(2), 800), // Pause
      setTimeout(() => {
        setPhase(3);
        setIsFlipped(true);
      }, 1300), // Flip
      setTimeout(() => setPhase(4), 1800), // Particle burst
      setTimeout(() => setPhase(5), 2200), // Settle
    ];

    return () => timers.forEach(clearTimeout);
  }, [isOpen]);

  const getTierColor = () => {
    switch (badgeData.tier) {
      case 'bronze':
        return {
          bg: 'from-[#D97706] to-[#92400E]',
          particles: 'rgba(217, 119, 6, 0.8)',
          glow: '#D97706',
        };
      case 'silver':
        return {
          bg: 'from-[#E5E7EB] to-[#9CA3AF]',
          particles: 'rgba(156, 163, 175, 0.8)',
          glow: '#E5E7EB',
        };
      case 'gold':
        return {
          bg: 'from-[#F59E0B] to-[#D97706]',
          particles: 'rgba(245, 158, 11, 0.9)',
          glow: '#F59E0B',
        };
      case 'platinum':
        return {
          bg: 'from-[#E5E7EB] via-[#F3F4F6] to-[#E5E7EB]',
          particles: 'rgba(229, 231, 235, 0.9)',
          glow: '#E5E7EB',
        };
      default:
        return {
          bg: 'from-[#6B7280] to-[#374151]',
          particles: 'rgba(107, 116, 128, 0.8)',
          glow: '#6B7280',
        };
    }
  };

  const tierColors = getTierColor();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]"
          />

          {/* Badge Card */}
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-full max-w-sm px-4">
            <motion.div
              initial={{ y: -500, scale: 0.5, rotateY: -180 }}
              animate={
                phase >= 1
                  ? {
                      y: 0,
                      scale: 1,
                      rotateY: isFlipped ? 0 : -180,
                    }
                  : {}
              }
              transition={{
                type: 'spring',
                damping: 15,
                stiffness: 100,
              }}
              style={{
                transformStyle: 'preserve-3d',
                perspective: 1000,
              }}
              className="relative"
            >
              {/* Card Back */}
              <motion.div
                className="absolute inset-0"
                style={{
                  backfaceVisibility: 'hidden',
                  rotateY: 180,
                }}
              >
                <Card className="h-96 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-2 border-[#FF6B35] flex items-center justify-center">
                  <div className="text-[#FF6B35] text-9xl opacity-20">?</div>
                </Card>
              </motion.div>

              {/* Card Front */}
              <motion.div
                style={{
                  backfaceVisibility: 'hidden',
                }}
              >
                <Card
                  className={`h-96 bg-gradient-to-br ${tierColors.bg} border-2 overflow-hidden relative`}
                  style={{
                    borderColor: tierColors.glow,
                    boxShadow: `0 0 30px ${tierColors.glow}40`,
                  }}
                >
                  {/* Glow effect */}
                  {phase >= 3 && (
                    <motion.div
                      className="absolute inset-0 opacity-40 blur-xl"
                      style={{ background: tierColors.glow }}
                      animate={{
                        opacity: [0.2, 0.5, 0.2],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }}
                    />
                  )}

                  <div className="relative z-10 h-full flex flex-col items-center justify-center p-8 text-center">
                    {/* Badge Icon */}
                    <motion.div
                      className="mb-6"
                      animate={
                        phase >= 4
                          ? {
                              scale: [1, 1.2, 1],
                              rotate: [0, 10, -10, 0],
                            }
                          : {}
                      }
                      transition={{ duration: 0.5 }}
                    >
                      {getBadgeIcon(badgeData.tier)}
                    </motion.div>

                    {/* Badge Name */}
                    <h2 className="text-3xl font-bold text-white mb-4 uppercase tracking-wider">
                      {badgeData.name}
                    </h2>

                    {/* Description */}
                    <p className="text-sm text-white/80 mb-6 max-w-xs">{badgeData.description}</p>

                    {/* Tier Badge */}
                    <Badge
                      className={`bg-white/20 text-white border-white/40 text-sm uppercase tracking-widest px-4 py-1`}
                    >
                      {badgeData.tier}
                    </Badge>

                    {/* Tap to continue */}
                    {phase >= 5 && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-xs text-white/60 mt-8"
                      >
                        Tap to continue
                      </motion.p>
                    )}
                  </div>
                </Card>
              </motion.div>
            </motion.div>
          </div>

          {/* Particle Burst */}
          <AnimatePresence>
            {phase >= 4 && (
              <ParticleBurst
                color={tierColors.particles}
                count={badgeData.tier === 'platinum' ? 150 : badgeData.tier === 'gold' ? 100 : 60}
                includeConfetti={badgeData.tier === 'gold' || badgeData.tier === 'platinum'}
              />
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}

function getBadgeIcon(tier: string) {
  const iconClass = 'w-20 h-20 text-white drop-shadow-2xl';

  switch (tier) {
    case 'bronze':
      return <Award className={iconClass} />;
    case 'silver':
      return <Star className={iconClass} />;
    case 'gold':
      return <Trophy className={iconClass} />;
    case 'platinum':
      return <Crown className={iconClass} />;
    default:
      return <Award className={iconClass} />;
  }
}

function ParticleBurst({
  color,
  count,
  includeConfetti,
}: {
  color: string;
  count: number;
  includeConfetti: boolean;
}) {
  const particles = Array.from({ length: count });

  return (
    <div className="fixed inset-0 z-[101] pointer-events-none">
      {particles.map((_, i) => {
        const angle = (Math.PI * 2 * i) / particles.length;
        const distance = 200 + Math.random() * 150;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance;
        const isConfetti = includeConfetti && Math.random() > 0.7;

        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              left: '50%',
              top: '50%',
              width: isConfetti ? 8 : 3,
              height: isConfetti ? 8 : 3,
              backgroundColor: isConfetti
                ? ['#FF6B35', '#F59E0B', '#10B981', '#DC2626'][Math.floor(Math.random() * 4)]
                : color,
              boxShadow: `0 0 ${isConfetti ? 15 : 8}px ${color}`,
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
            animate={{
              x,
              y: y + (isConfetti ? Math.random() * 100 : 0),
              opacity: 0,
              scale: isConfetti ? [1, 1.5, 0] : 0,
              rotate: isConfetti ? Math.random() * 360 : 0,
            }}
            transition={{
              duration: isConfetti ? 2 : 1.5,
              ease: 'easeOut',
            }}
          />
        );
      })}
    </div>
  );
}
