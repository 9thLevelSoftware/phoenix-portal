import { motion } from 'motion/react';
import { PLACEMENT_CONFIG } from './types';

interface PodiumProps {
  userPlacement: 1 | 2 | 3;
}

export function Podium({ userPlacement }: PodiumProps) {
  const positions = [
    { place: 2 as const, height: 80, left: 0, width: 90 },
    { place: 1 as const, height: 120, left: 105, width: 90 },
    { place: 3 as const, height: 80, left: 210, width: 90 },
  ];

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      transition={{
        type: 'spring',
        damping: 20,
        stiffness: 100,
        delay: 0.2,
      }}
      className="relative w-[300px] h-[150px] mx-auto"
    >
      {/* Shadow underneath */}
      <div className="absolute -bottom-2 left-0 right-0 h-4 bg-black/20 blur-xl rounded-full" />

      {/* Podium positions */}
      {positions.map((pos) => {
        const config = PLACEMENT_CONFIG[pos.place];
        const isUser = pos.place === userPlacement;

        return (
          <motion.div
            key={pos.place}
            className="absolute bottom-0 rounded-t-lg overflow-hidden"
            style={{
              left: pos.left,
              width: pos.width,
              height: pos.height,
              background: config.bgGradient,
              boxShadow: isUser
                ? `0 0 20px ${config.color}80, 0 10px 30px rgba(0,0,0,0.4)`
                : '0 10px 30px rgba(0,0,0,0.4)',
            }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{
              delay: 0.4 + pos.place * 0.1,
              type: 'spring',
              damping: 15,
              stiffness: 150,
            }}
          >
            {/* Metallic shine effect */}
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background:
                  'linear-gradient(to bottom, rgba(255,255,255,0.3) 0%, transparent 50%, rgba(0,0,0,0.2) 100%)',
              }}
            />

            {/* Place number */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className="text-4xl font-bold opacity-90"
                style={{
                  textShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  color: pos.place === 1 ? '#FFFFFF' : 'rgba(255,255,255,0.9)',
                }}
              >
                {pos.place}
              </span>
            </div>

            {/* Glow effect for user's position */}
            {isUser && (
              <motion.div
                className="absolute inset-0 border-t-4 rounded-t-lg"
                style={{ borderColor: config.color }}
                animate={{
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
