import { useState } from 'react';
import { motion } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { PRCelebration } from '@/app/components/celebrations/PRCelebration';
import { BadgeEarned } from '@/app/components/celebrations/BadgeEarned';
import { StreakMilestone } from '@/app/components/celebrations/StreakMilestone';
import { ChallengeWon } from '@/app/components/celebrations/ChallengeWon';
import { WorkoutComplete } from '@/app/components/celebrations/WorkoutComplete';
import { Trophy, Award, Flame, Zap, Medal, Check } from 'lucide-react';

export function CelebrationDemo() {
  const [showPR, setShowPR] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [showStreak, setShowStreak] = useState(false);
  const [showChallengeWon, setShowChallengeWon] = useState(false);
  const [showWorkoutComplete, setShowWorkoutComplete] = useState(false);
  const [selectedBadgeTier, setSelectedBadgeTier] = useState<'bronze' | 'silver' | 'gold' | 'platinum'>('gold');
  const [selectedStreak, setSelectedStreak] = useState(7);
  const [selectedPlacement, setSelectedPlacement] = useState<1 | 2 | 3>(1);

  return (
    <div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
      {/* Header */}
      <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <h1 className="text-3xl sm:text-4xl mb-2">
              <span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                Celebration Animations
              </span>
            </h1>
            <p className="text-[#9CA3AF]">Test all celebration animations and micro-interactions</p>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* PR Celebration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center">
                <Trophy className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Personal Record Celebration</h3>
                <p className="text-sm text-[#9CA3AF] mb-4">
                  Full animation sequence with phoenix rise, particle burst, and PR card reveal
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Button
                  onClick={() => setShowPR(true)}
                  className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
                >
                  Weight PR
                </Button>
                <Button
                  onClick={() => setShowPR(true)}
                  className="bg-gradient-to-r from-[#6366F1] to-[#4F46E5] hover:from-[#4F46E5] hover:to-[#6366F1] border-0"
                >
                  Volume PR
                </Button>
                <Button
                  onClick={() => setShowPR(true)}
                  className="bg-gradient-to-r from-[#F59E0B] to-[#D97706] hover:from-[#D97706] hover:to-[#F59E0B] border-0"
                >
                  1RM Estimate
                </Button>
              </div>
              <p className="text-xs text-[#6B7280]">
                ✨ Features: Phoenix rise animation, ember trail, particle burst, glowing PR card
              </p>
            </div>
          </Card>
        </motion.div>

        {/* Badge Earned */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#F59E0B] to-[#D97706] flex items-center justify-center">
                <Award className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Badge Unlocked</h3>
                <p className="text-sm text-[#9CA3AF] mb-4">
                  Dramatic card flip reveal with tier-specific particle effects and colors
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => {
                    setSelectedBadgeTier('bronze');
                    setShowBadge(true);
                  }}
                  className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#D97706] to-[#92400E] text-white text-sm font-medium hover:scale-105 transition-transform"
                >
                  Bronze
                </button>
                <button
                  onClick={() => {
                    setSelectedBadgeTier('silver');
                    setShowBadge(true);
                  }}
                  className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#E5E7EB] to-[#9CA3AF] text-[#1a1a1a] text-sm font-medium hover:scale-105 transition-transform"
                >
                  Silver
                </button>
                <button
                  onClick={() => {
                    setSelectedBadgeTier('gold');
                    setShowBadge(true);
                  }}
                  className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#F59E0B] to-[#D97706] text-white text-sm font-medium hover:scale-105 transition-transform"
                >
                  Gold
                </button>
                <button
                  onClick={() => {
                    setSelectedBadgeTier('platinum');
                    setShowBadge(true);
                  }}
                  className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#E5E7EB] via-[#F3F4F6] to-[#E5E7EB] text-[#1a1a1a] text-sm font-medium hover:scale-105 transition-transform"
                >
                  Platinum
                </button>
              </div>
              <p className="text-xs text-[#6B7280]">
                ✨ Features: 3D card flip, tier-specific particles, confetti for Gold/Platinum
              </p>
            </div>
          </Card>
        </motion.div>

        {/* Streak Milestone */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#F59E0B] flex items-center justify-center">
                <Flame className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Streak Milestones</h3>
                <p className="text-sm text-[#9CA3AF] mb-4">
                  Flame intensify animation with expanding rings and milestone-specific messages
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[7, 14, 30, 60, 90, 180, 365].map((streak) => (
                  <button
                    key={streak}
                    onClick={() => {
                      setSelectedStreak(streak);
                      setShowStreak(true);
                    }}
                    className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border border-[#374151] hover:border-[#FF6B35] text-white text-sm font-medium transition-all"
                  >
                    {streak} days
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#6B7280]">
                ✨ Features: Flame intensify, expanding fire rings, ember particles, special 365-day animation
              </p>
            </div>
          </Card>
        </motion.div>

        {/* Challenge Won */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#F59E0B] flex items-center justify-center">
                <Medal className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Challenge Won</h3>
                <p className="text-sm text-[#9CA3AF] mb-4">
                  Animated medal reveal with tier-specific particle effects and colors
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => {
                    setSelectedPlacement(1);
                    setShowChallengeWon(true);
                  }}
                  className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#F59E0B] to-[#FBBF24] text-white text-sm font-medium hover:scale-105 transition-transform"
                >
                  👑 1st Place
                </button>
                <button
                  onClick={() => {
                    setSelectedPlacement(2);
                    setShowChallengeWon(true);
                  }}
                  className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#E5E7EB] to-[#9CA3AF] text-[#1a1a1a] text-sm font-medium hover:scale-105 transition-transform"
                >
                  🥈 2nd Place
                </button>
                <button
                  onClick={() => {
                    setSelectedPlacement(3);
                    setShowChallengeWon(true);
                  }}
                  className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#D97706] to-[#92400E] text-white text-sm font-medium hover:scale-105 transition-transform"
                >
                  🥉 3rd Place
                </button>
              </div>
              <p className="text-xs text-[#6B7280]">
                ✨ Features: Podium rise, avatar drop, spotlights, confetti burst, rewards card
              </p>
            </div>
          </Card>
        </motion.div>

        {/* Workout Complete */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#10B981] to-[#059669] flex items-center justify-center">
                <Check className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Workout Complete</h3>
                <p className="text-sm text-[#9CA3AF] mb-4">
                  Animated checkmark with particle burst and confetti
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => setShowWorkoutComplete(true)}
                  className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#10B981] to-[#059669] text-white text-sm font-medium hover:scale-105 transition-transform"
                >
                  Complete
                </button>
              </div>
              <p className="text-xs text-[#6B7280]">
                ✨ Features: Checkmark animation, particle burst, confetti
              </p>
            </div>
          </Card>
        </motion.div>

        {/* Micro Celebrations Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#10B981] to-[#059669] flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Micro-Celebrations</h3>
                <p className="text-sm text-[#9CA3AF] mb-4">
                  Subtle, frequent celebrations integrated throughout the app
                </p>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3 p-3 bg-[#0D0D0D] rounded-lg border border-[#374151]">
                <div className="w-8 h-8 rounded-full bg-[#10B981]/20 flex items-center justify-center">
                  <span className="text-lg">✓</span>
                </div>
                <div>
                  <div className="text-white font-medium">Set Complete</div>
                  <div className="text-xs text-[#6B7280]">Brief pulse + checkmark animation</div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-[#0D0D0D] rounded-lg border border-[#374151]">
                <div className="w-8 h-8 rounded-full bg-[#F59E0B]/20 flex items-center justify-center">
                  <span className="text-lg">↑</span>
                </div>
                <div>
                  <div className="text-white font-medium">Weight Increase</div>
                  <div className="text-xs text-[#6B7280]">Arrow animation + ember sparkle</div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-[#0D0D0D] rounded-lg border border-[#374151]">
                <div className="w-8 h-8 rounded-full bg-[#6366F1]/20 flex items-center justify-center">
                  <span className="text-lg">⏱️</span>
                </div>
                <div>
                  <div className="text-white font-medium">Rest Timer Complete</div>
                  <div className="text-xs text-[#6B7280]">Gentle pulse + wing flap icon</div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Celebration Components */}
      <PRCelebration
        isOpen={showPR}
        onClose={() => setShowPR(false)}
        prData={{
          exerciseName: 'Bench Press',
          weight: 120,
          reps: 5,
          estimated1RM: 135,
          improvement: 15,
          type: 'weight',
        }}
      />

      <BadgeEarned
        isOpen={showBadge}
        onClose={() => setShowBadge(false)}
        badgeData={{
          name: 'Week Warrior',
          description: 'Completed 7 workouts in a single week',
          tier: selectedBadgeTier,
          icon: '🔥',
        }}
      />

      <StreakMilestone
        isOpen={showStreak}
        onClose={() => setShowStreak(false)}
        streak={selectedStreak}
      />

      <ChallengeWon
        placement={selectedPlacement}
        challengeName="January Volume Challenge"
        challengeType="Volume"
        userAvatar="JD"
        rewards={[
          { type: 'badge', name: 'Phoenix Champion Badge', icon: '🏆' },
          { type: 'premium', name: '1 Month Premium', icon: '✨' },
          { type: 'points', name: '500 XP Bonus', icon: '🔥' },
        ]}
        onDismiss={() => setShowChallengeWon(false)}
        onViewResults={() => {
          setShowChallengeWon(false);
          console.log('View results clicked');
        }}
      />

      <WorkoutComplete
        isOpen={showWorkoutComplete}
        onClose={() => setShowWorkoutComplete(false)}
        duration="58 min"
        volume="5,200 kg"
        prsAchieved={2}
        streakContinued={true}
        onViewSummary={() => {
          setShowWorkoutComplete(false);
          console.log('View summary clicked');
        }}
      />
    </div>
  );
}