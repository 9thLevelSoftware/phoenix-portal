import { motion } from 'motion/react';

export function Spotlight() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Left spotlight */}
      <motion.div
        className="absolute left-1/4 -top-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{
          delay: 1.5,
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        <div
          className="w-32 h-96"
          style={{
            background: 'linear-gradient(to bottom, rgba(251, 191, 36, 0.3) 0%, transparent 100%)',
            transform: 'rotate(15deg)',
            filter: 'blur(20px)',
          }}
        />
      </motion.div>

      {/* Right spotlight */}
      <motion.div
        className="absolute right-1/4 -top-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{
          delay: 1.7,
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        <div
          className="w-32 h-96"
          style={{
            background: 'linear-gradient(to bottom, rgba(251, 191, 36, 0.3) 0%, transparent 100%)',
            transform: 'rotate(-15deg)',
            filter: 'blur(20px)',
          }}
        />
      </motion.div>

      {/* Center glow */}
      <motion.div
        className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2"
        initial={{ opacity: 0, scale: 0 }}
        animate={{
          opacity: [0, 0.4, 0.2],
          scale: [0, 1.5, 2],
        }}
        transition={{
          delay: 1.5,
          duration: 1.5,
          ease: 'easeOut',
        }}
      >
        <div
          className="w-96 h-96 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(251, 191, 36, 0.3) 0%, transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
      </motion.div>
    </div>
  );
}
