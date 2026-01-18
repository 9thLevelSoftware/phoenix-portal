// Challenge Won Celebration Types

export interface ChallengeReward {
  type: 'badge' | 'premium' | 'points' | 'title';
  name: string;
  icon?: string; // Emoji or icon name
}

export interface ChallengeWonProps {
  placement: 1 | 2 | 3;
  challengeName: string;
  challengeType?: string; // "Volume" | "Streak" | "PR" etc.
  userAvatar?: string; // Initials like "JD"
  rewards: ChallengeReward[];
  onDismiss: () => void;
  onViewResults?: () => void;
}

export interface ConfettiPiece {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  rotation: number;
  velocityX: number;
  velocityY: number;
}

export const PLACEMENT_CONFIG = {
  1: {
    color: '#F59E0B',
    gradient: 'from-[#F59E0B] to-[#FBBF24]',
    bgGradient: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
    icon: '👑',
    label: '1st',
    confettiCount: 100,
    confettiColors: ['#F59E0B', '#FBBF24', '#FFFFFF', '#FF6B35'],
  },
  2: {
    color: '#E5E7EB',
    gradient: 'from-[#E5E7EB] to-[#9CA3AF]',
    bgGradient: 'linear-gradient(135deg, #E5E7EB 0%, #9CA3AF 100%)',
    icon: '🥈',
    label: '2nd',
    confettiCount: 50,
    confettiColors: ['#E5E7EB', '#9CA3AF', '#FFFFFF'],
  },
  3: {
    color: '#D97706',
    gradient: 'from-[#D97706] to-[#92400E]',
    bgGradient: 'linear-gradient(135deg, #D97706 0%, #92400E 100%)',
    icon: '🥉',
    label: '3rd',
    confettiCount: 30,
    confettiColors: ['#D97706', '#92400E', '#FF6B35', '#F59E0B'],
  },
} as const;
