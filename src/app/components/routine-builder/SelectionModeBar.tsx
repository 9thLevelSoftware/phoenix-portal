import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Check } from 'lucide-react';

interface SelectionModeBarProps {
  selectedCount: number;
  onCreateSuperset: () => void;
  onCancel: () => void;
}

export function SelectionModeBar({ selectedCount, onCreateSuperset, onCancel }: SelectionModeBarProps) {
  return (
    <AnimatePresence>
      {selectedCount >= 2 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 px-4"
        >
          <Card className="px-6 py-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-2 border-[#FF6B35] shadow-2xl">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-white">
                <Check className="w-5 h-5 text-[#10B981]" />
                <span className="font-semibold">{selectedCount}</span>
                <span className="text-[#9CA3AF]">exercises selected</span>
              </div>

              <div className="h-6 w-px bg-[#374151]" />

              <div className="flex items-center gap-3">
                <Button
                  onClick={onCreateSuperset}
                  className="bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
                >
                  Create Superset
                </Button>

                <Button
                  onClick={onCancel}
                  variant="ghost"
                  className="text-[#9CA3AF] hover:text-white"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
