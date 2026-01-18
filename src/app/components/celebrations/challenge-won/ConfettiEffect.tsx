import { useEffect, useRef } from 'react';
import { ConfettiPiece } from './types';

interface ConfettiEffectProps {
  colors: string[];
  count: number;
  trigger: boolean;
}

export function ConfettiEffect({ colors, count, trigger }: ConfettiEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!trigger) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Generate confetti pieces
    const confetti: ConfettiPiece[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      x: canvas.width / 2 + (Math.random() - 0.5) * 200, // Center with spread
      y: canvas.height, // Start at bottom
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 3 + Math.random() * 5,
      rotation: Math.random() * 360,
      velocityX: (Math.random() - 0.5) * 10,
      velocityY: -15 - Math.random() * 10, // Upward velocity
    }));

    let animationId: number;
    const gravity = 0.5;
    const friction = 0.99;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      confetti.forEach((piece) => {
        // Update physics
        piece.velocityY += gravity;
        piece.velocityX *= friction;
        piece.velocityY *= friction;
        piece.x += piece.velocityX;
        piece.y += piece.velocityY;
        piece.rotation += piece.velocityX * 0.5;

        // Fade out near bottom
        const opacity = piece.y < canvas.height - 100 ? 1 : Math.max(0, (canvas.height - piece.y) / 100);

        if (opacity > 0) {
          ctx.save();
          ctx.translate(piece.x, piece.y);
          ctx.rotate((piece.rotation * Math.PI) / 180);
          ctx.globalAlpha = opacity;
          ctx.fillStyle = piece.color;

          // Draw confetti piece (rectangle)
          ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 2);

          ctx.restore();
        }
      });

      // Continue animation if confetti still visible
      if (confetti.some((p) => p.y < canvas.height + 50)) {
        animationId = requestAnimationFrame(animate);
      }
    };

    // Start animation after small delay
    setTimeout(() => {
      animationId = requestAnimationFrame(animate);
    }, 100);

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [trigger, colors, count]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50"
      style={{ mixBlendMode: 'screen' }}
    />
  );
}
