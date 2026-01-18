import { Info, X } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export function PortalBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="bg-gradient-to-r from-[#FF6B35]/10 to-[#F59E0B]/10 border border-[#FF6B35]/30 rounded-lg p-3 mb-6"
      >
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-[#FF6B35] flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-[#E5E7EB]">
              <span className="font-semibold text-[#FF6B35]">Phoenix Portal</span> displays
              workout data synced from your mobile app. Create and share routines that sync
              back to your Vitruvian trainer.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss banner"
            className="text-[#9CA3AF] hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#FF6B35] rounded"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
