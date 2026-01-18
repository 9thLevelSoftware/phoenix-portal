import { motion } from 'motion/react';
import { LayoutDashboard, BarChart3, Trophy, Users, User, Flame } from 'lucide-react';

interface MobileBottomNavProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  streak?: number;
  notifications?: {
    challenges?: number;
    community?: number;
  };
}

export function MobileBottomNav({
  currentPage,
  onNavigate,
  streak = 0,
  notifications = {},
}: MobileBottomNavProps) {
  const navItems = [
    { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'challenges', label: 'Challenges', icon: Trophy },
    { id: 'community', label: 'Community', icon: Users },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0D0D0D]/95 backdrop-blur-lg border-t border-[#374151] pb-safe">
      <div className="flex items-center justify-around px-2 py-2 max-w-screen-xl mx-auto">
        {navItems.map((item) => {
          const isActive = currentPage === item.id;
          const Icon = item.icon;
          const hasNotification =
            (item.id === 'challenges' && notifications.challenges) ||
            (item.id === 'community' && notifications.community);

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className="relative flex flex-col items-center gap-1 py-2 px-3 min-w-[60px] transition-colors"
            >
              {/* Active indicator line */}
              {isActive && (
                <motion.div
                  layoutId="activeMobileTab"
                  className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}

              {/* Icon with notification badge */}
              <div className="relative">
                <Icon
                  className={`w-6 h-6 transition-all ${
                    isActive ? 'text-[#FF6B35] scale-110' : 'text-[#9CA3AF]'
                  }`}
                />

                {/* Notification badge */}
                {hasNotification && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-[#DC2626] text-white text-[10px] font-bold rounded-full flex items-center justify-center"
                  >
                    {item.id === 'challenges' && notifications.challenges
                      ? notifications.challenges
                      : notifications.community}
                  </motion.span>
                )}

                {/* Streak indicator on dashboard */}
                {item.id === 'dashboard' && streak > 0 && !isActive && (
                  <motion.div
                    className="absolute -top-2 -right-2"
                    animate={{
                      scale: [1, 1.2, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  >
                    <Flame className="w-3 h-3 text-[#F59E0B]" fill="#FF6B35" />
                  </motion.div>
                )}
              </div>

              {/* Label */}
              <motion.span
                className={`text-xs transition-all ${
                  isActive ? 'text-[#FF6B35] font-medium' : 'text-[#9CA3AF]'
                }`}
                animate={{
                  opacity: isActive ? 1 : 0.8,
                  y: isActive ? 0 : 1,
                }}
              >
                {item.label}
              </motion.span>

              {/* Active glow effect */}
              {isActive && (
                <motion.div
                  className="absolute inset-0 bg-[#FF6B35]/10 rounded-lg -z-10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Safe area for devices with notches/home indicators */}
      <div className="h-safe-area-inset-bottom bg-[#0D0D0D]" />
    </nav>
  );
}
