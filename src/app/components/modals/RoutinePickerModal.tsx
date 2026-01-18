import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { X, Search, Dumbbell } from 'lucide-react';

interface RoutinePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  routines: Array<{
    id: string;
    name: string;
    exercises: number;
    duration: number;
    muscleGroup: string;
  }>;
  onSelect: (routineId: string) => void;
}

export function RoutinePickerModal({ isOpen, onClose, routines, onSelect }: RoutinePickerModalProps) {
  const recent = routines.slice(0, 2);
  const all = routines;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 z-50"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl z-50 max-h-[80vh] overflow-hidden"
          >
            <Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-[#374151]">
                <h2 className="text-xl font-semibold text-white">Select Routine</h2>
                <Button variant="ghost" size="sm" onClick={onClose}>
                  <X className="w-5 h-5" />
                </Button>
              </div>

              {/* Search */}
              <div className="p-6 border-b border-[#374151]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#6B7280]" />
                  <Input
                    placeholder="Search routines..."
                    className="pl-10 bg-[#0D0D0D] border-[#374151]"
                  />
                </div>
              </div>

              {/* Content */}
              <div className="p-6 overflow-y-auto max-h-[calc(80vh-200px)]">
                {/* Recent */}
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-[#9CA3AF] uppercase mb-3">Recent</h3>
                  <div className="space-y-2">
                    {recent.map((routine) => (
                      <button
                        key={routine.id}
                        onClick={() => onSelect(routine.id)}
                        className="w-full p-4 bg-[#0D0D0D] border border-[#374151] rounded-lg hover:border-[#FF6B35] transition-all text-left group"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center">
                              <Dumbbell className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <div className="font-semibold text-white">{routine.name}</div>
                              <div className="text-sm text-[#9CA3AF]">
                                {routine.exercises} exercises • ~{routine.duration} min
                              </div>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="bg-[#FF6B35] hover:bg-[#DC2626] border-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Select
                          </Button>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* All Routines */}
                <div>
                  <h3 className="text-sm font-semibold text-[#9CA3AF] uppercase mb-3">All My Routines</h3>
                  <div className="space-y-2">
                    {all.map((routine) => (
                      <button
                        key={routine.id}
                        onClick={() => onSelect(routine.id)}
                        className="w-full p-4 bg-[#0D0D0D] border border-[#374151] rounded-lg hover:border-[#FF6B35] transition-all text-left group"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-white">{routine.name}</div>
                            <div className="text-sm text-[#9CA3AF]">
                              {routine.exercises} exercises • ~{routine.duration} min
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="bg-[#FF6B35] hover:bg-[#DC2626] border-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Select
                          </Button>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-[#374151]">
                <Button
                  variant="outline"
                  className="w-full border-[#FF6B35] text-[#FF6B35] hover:bg-[#FF6B35]/10"
                >
                  + Create New Routine
                </Button>
              </div>
            </Card>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
