import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, PanInfo } from 'motion/react';
import { X } from 'lucide-react';
import { Button } from '@/app/components/ui/button';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  snapPoints?: number[]; // Percentages of screen height: [30, 60, 90]
  defaultSnap?: number; // Index of default snap point
  showHandle?: boolean;
  showCloseButton?: boolean;
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  snapPoints = [30, 60, 90],
  defaultSnap = 1,
  showHandle = true,
  showCloseButton = true,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const containerHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

  // Current snap point in pixels
  const currentSnapPoint = (containerHeight * snapPoints[defaultSnap]) / 100;

  // Background opacity based on drag position
  const backgroundOpacity = useTransform(y, [0, 300], [0.6, 0]);

  useEffect(() => {
    if (isOpen) {
      // Prevent body scroll when sheet is open
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    const velocity = info.velocity.y;
    const currentY = y.get();

    // Dismiss if dragged down significantly or with high velocity
    if (currentY > 150 || velocity > 500) {
      onClose();
      return;
    }

    // Find nearest snap point
    const snapPointsInPx = snapPoints.map((p) => containerHeight - (containerHeight * p) / 100);
    const nearest = snapPointsInPx.reduce((prev, curr) =>
      Math.abs(curr - currentY) < Math.abs(prev - currentY) ? curr : prev
    );

    y.set(nearest);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Background Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.6 }}
        exit={{ opacity: 0 }}
        style={{ opacity: backgroundOpacity }}
        onClick={onClose}
        className="fixed inset-0 bg-black z-[90] md:hidden"
      />

      {/* Bottom Sheet */}
      <motion.div
        ref={sheetRef}
        drag="y"
        dragConstraints={{ top: 0, bottom: 300 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        style={{ y }}
        initial={{ y: containerHeight }}
        animate={{ y: containerHeight - currentSnapPoint }}
        exit={{ y: containerHeight }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed left-0 right-0 bottom-0 z-[95] md:hidden"
      >
        <div className="bg-[#0D0D0D] rounded-t-3xl shadow-2xl border-t border-[#374151] max-h-screen flex flex-col">
          {/* Drag Handle */}
          {showHandle && (
            <div className="pt-3 pb-2 flex justify-center cursor-grab active:cursor-grabbing">
              <div className="w-12 h-1.5 bg-[#374151] rounded-full" />
            </div>
          )}

          {/* Header */}
          {(title || showCloseButton) && (
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#374151]">
              {title && <h2 className="text-lg font-semibold text-white">{title}</h2>}
              {!title && <div />}
              {showCloseButton && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  className="text-[#9CA3AF] hover:text-white -mr-2"
                >
                  <X className="w-5 h-5" />
                </Button>
              )}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            {children}
          </div>

          {/* Safe area for notched devices */}
          <div className="h-safe-area-inset-bottom bg-[#0D0D0D]" />
        </div>
      </motion.div>
    </>
  );
}
