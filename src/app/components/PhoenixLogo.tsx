import { motion } from 'motion/react';
import phoenixLogo from '@/assets/4aa483a986255912b80c24338a4e7f563d95eabd.png';

export function PhoenixLogo({ size = 'md', animated = true }: { size?: 'sm' | 'md' | 'lg' | 'xl'; animated?: boolean }) {
  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-24 h-24',
    xl: 'w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 lg:w-[32rem] lg:h-[32rem]',
  };

  const Logo = animated ? motion.div : 'div';

  return (
    <Logo
      className={`${sizes[size]} relative flex items-center justify-center`}
      {...(animated && {
        whileHover: { scale: 1.1 },
        transition: { duration: 0.3 },
      })}
    >
      <img 
        src={phoenixLogo} 
        alt="Project Phoenix Logo" 
        className={`${sizes[size]} object-contain`}
      />
    </Logo>
  );
}