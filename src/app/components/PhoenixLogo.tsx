import { motion } from 'motion/react';
import logo64 from '@/assets/phoenix-logo-64.webp';
import logo96 from '@/assets/phoenix-logo-96.webp';
import logo192 from '@/assets/phoenix-logo-192.webp';
import logo512 from '@/assets/phoenix-logo-512.webp';
import logoFallback from '@/assets/phoenix-logo-fallback.png';

const sizeConfig = {
  sm: { className: 'w-8 h-8', src: logo64, srcSet: `${logo64} 64w, ${logo96} 96w`, sizes: '32px' },
  md: { className: 'w-12 h-12', src: logo96, srcSet: `${logo64} 64w, ${logo96} 96w, ${logo192} 192w`, sizes: '48px' },
  lg: { className: 'w-24 h-24', src: logo192, srcSet: `${logo96} 96w, ${logo192} 192w, ${logo512} 512w`, sizes: '96px' },
  xl: { className: 'w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 lg:w-[32rem] lg:h-[32rem]', src: logo512, srcSet: `${logo192} 192w, ${logo512} 512w`, sizes: '(min-width: 1024px) 512px, (min-width: 768px) 384px, (min-width: 640px) 320px, 256px' },
};

export function PhoenixLogo({ size = 'md', animated = true }: { size?: 'sm' | 'md' | 'lg' | 'xl'; animated?: boolean }) {
  const config = sizeConfig[size];
  const Logo = animated ? motion.div : 'div';

  return (
    <Logo
      className={`${config.className} relative flex items-center justify-center`}
      {...(animated && {
        whileHover: { scale: 1.1 },
        transition: { duration: 0.3 },
      })}
    >
      <picture>
        <source type="image/webp" srcSet={config.srcSet} sizes={config.sizes} />
        <img
          src={logoFallback}
          alt="Project Phoenix Logo"
          className={`${config.className} object-contain`}
          loading={size === 'xl' ? 'eager' : 'lazy'}
          decoding="async"
        />
      </picture>
    </Logo>
  );
}
