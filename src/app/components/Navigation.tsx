import { PhoenixLogo } from './PhoenixLogo';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Avatar, AvatarFallback } from '@/app/components/ui/avatar';
import {
  LayoutDashboard,
  BarChart3,
  Trophy,
  Users,
  Calendar,
  User,
  Settings,
  Bell,
  Flame,
  History,
  Award,
  Repeat,
  Dumbbell,
} from 'lucide-react';
import { motion } from 'motion/react';

interface NavigationProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  streak: number;
}

export function Navigation({ currentPage, onNavigate, streak }: NavigationProps) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'history', label: 'History', icon: History },
    { id: 'records', label: 'Records', icon: Award },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'challenges', label: 'Challenges', icon: Trophy },
    { id: 'community', label: 'Community', icon: Users },
    { id: 'routines', label: 'Routines', icon: Dumbbell },
    { id: 'cycles', label: 'Cycles', icon: Repeat },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:block sticky top-0 z-50 bg-[#0D0D0D]/95 backdrop-blur-lg border-b border-[#374151]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => onNavigate('dashboard')}>
              <PhoenixLogo size="sm" />
              <span className="text-xl bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
                Project Phoenix
              </span>
            </div>

            {/* Navigation Items */}
            <div className="flex items-center gap-1">
              {navItems.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  onClick={() => onNavigate(item.id)}
                  className={`relative text-[#E5E7EB] hover:text-white hover:bg-[#FF6B35]/10 ${
                    currentPage === item.id ? 'text-white' : ''
                  }`}
                >
                  <item.icon className="w-4 h-4 mr-2" />
                  {item.label}
                  {currentPage === item.id && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#FF6B35] to-[#DC2626]"
                    />
                  )}
                </Button>
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

              {/* User Avatar */}
              <Avatar className="cursor-pointer ring-2 ring-[#FF6B35] ring-offset-2 ring-offset-[#0D0D0D]" onClick={() => onNavigate('profile')}>
                <AvatarFallback className="bg-gradient-to-br from-[#FF6B35] to-[#DC2626] text-white">
                  JD
                </AvatarFallback>
              </Avatar>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0D0D0D]/95 backdrop-blur-lg border-t border-[#374151]">
        <div className="flex items-center justify-around px-2 py-2">
          {navItems.slice(0, 5).map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              size="icon"
              onClick={() => onNavigate(item.id)}
              className={`relative flex flex-col items-center gap-1 h-auto py-2 px-4 ${
                currentPage === item.id
                  ? 'text-[#FF6B35]'
                  : 'text-[#9CA3AF] hover:text-[#E5E7EB]'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-xs">{item.label}</span>
              {currentPage === item.id && (
                <motion.div
                  layoutId="activeMobileTab"
                  className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#FF6B35] to-[#DC2626]"
                />
              )}
            </Button>
          ))}
        </div>
      </nav>
    </>
  );
}