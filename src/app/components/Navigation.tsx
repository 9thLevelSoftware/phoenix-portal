import { PhoenixLogo } from './PhoenixLogo';
import { Button } from '@/app/components/ui/button';
import { Avatar, AvatarFallback } from '@/app/components/ui/avatar';
import {
  LayoutDashboard,
  BarChart3,
  Trophy,
  Users,
  User,
  Bell,
  Flame,
  History,
  Award,
  Repeat,
  Dumbbell,
  LogOut,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '@/app/hooks/useAuth';
import { NavLink, Link } from 'react-router';
import { useUIStore } from '@/stores/useUIStore';
import { TierBadge } from '@/app/components/TierBadge';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/history', label: 'History', icon: History },
  { path: '/records', label: 'Records', icon: Award },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/challenges', label: 'Challenges', icon: Trophy },
  { path: '/community', label: 'Community', icon: Users },
  { path: '/routines', label: 'Routines', icon: Dumbbell },
  { path: '/cycles', label: 'Cycles', icon: Repeat },
  { path: '/profile', label: 'Profile', icon: User },
];

export function Navigation() {
  const { signOut } = useAuth();
  const streak = useUIStore((s) => s.streak);

  return (
    <nav className="hidden md:block sticky top-0 z-50 bg-[#0D0D0D]/95 backdrop-blur-lg border-b border-[#374151]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/dashboard" className="flex items-center gap-3 cursor-pointer">
            <PhoenixLogo size="sm" />
            <span className="text-xl bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
              Project Phoenix
            </span>
          </Link>

          {/* Navigation Items */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `relative inline-flex items-center px-3 py-2 text-sm font-medium rounded-md text-[#E5E7EB] hover:text-white hover:bg-[#FF6B35]/10 ${
                    isActive ? 'text-white' : ''
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className="w-4 h-4 mr-2" />
                    {item.label}
                    {isActive && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#FF6B35] to-[#DC2626]"
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-4">
            {/* Notification Bell */}
            <Button variant="ghost" size="icon" className="relative hover:bg-[#FF6B35]/10">
              <Bell className="w-5 h-5 text-[#E5E7EB]" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-[#FF6B35] rounded-full animate-pulse" />
            </Button>

            {/* Streak Indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-[#FF6B35]/20 to-[#DC2626]/20 border border-[#FF6B35]/50 rounded-full">
              <Flame className="w-4 h-4 text-[#F59E0B]" fill="#FF6B35" />
              <span className="text-sm text-white">{streak} day streak</span>
            </div>

            {/* Tier Badge */}
            <TierBadge />

            {/* User Avatar */}
            <Link to="/profile">
              <Avatar className="cursor-pointer ring-2 ring-[#FF6B35] ring-offset-2 ring-offset-[#0D0D0D]">
                <AvatarFallback className="bg-gradient-to-br from-[#FF6B35] to-[#DC2626] text-white">
                  JD
                </AvatarFallback>
              </Avatar>
            </Link>

            {/* Logout */}
            <Button
              variant="ghost"
              size="icon"
              title="Sign out"
              className="hover:bg-[#DC2626]/10 hover:text-[#DC2626]"
              onClick={async () => { await signOut(); }}
            >
              <LogOut className="w-5 h-5 text-[#E5E7EB]" />
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
