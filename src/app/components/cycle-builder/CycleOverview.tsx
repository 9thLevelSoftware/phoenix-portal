import { Card } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Calendar } from 'lucide-react';

interface CycleOverviewProps {
  name: string;
  description: string;
  duration: number;
  startDate: string;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onDurationChange: (duration: number) => void;
  onStartDateChange: (date: string) => void;
}

export function CycleOverview({
  name,
  description,
  duration,
  startDate,
  onNameChange,
  onDescriptionChange,
  onDurationChange,
  onStartDateChange,
}: CycleOverviewProps) {
  const durationPresets = [3, 4, 5, 6, 7];
  const isCustomDuration = !durationPresets.includes(duration);

  return (
    <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
      <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
        <Calendar className="w-5 h-5 text-[#FF6B35]" />
        Cycle Details
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cycle Name */}
        <div className="md:col-span-2">
          <Label className="text-[#E5E7EB] mb-2">Cycle Name</Label>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="bg-[#0D0D0D] border-[#374151] focus:border-[#FF6B35] focus:ring-[#FF6B35]/20"
            placeholder="e.g., 12-Week Strength Builder"
          />
        </div>

        {/* Description */}
        <div className="md:col-span-2">
          <Label className="text-[#E5E7EB] mb-2">Description (optional)</Label>
          <Textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            className="bg-[#0D0D0D] border-[#374151] focus:border-[#FF6B35] focus:ring-[#FF6B35]/20 min-h-[100px]"
            placeholder="Progressive overload program with periodization and scheduled deload weeks for optimal recovery..."
          />
        </div>

        {/* Cycle Duration */}
        <div className="md:col-span-2">
          <Label className="text-[#E5E7EB] mb-2">Cycle Duration</Label>
          <div className="flex flex-wrap items-center gap-2">
            {durationPresets.map((days) => (
              <Button
                key={days}
                size="sm"
                variant={duration === days ? 'default' : 'outline'}
                onClick={() => onDurationChange(days)}
                className={
                  duration === days
                    ? 'bg-[#FF6B35] hover:bg-[#DC2626] border-0'
                    : 'border-[#374151] hover:border-[#FF6B35]'
                }
              >
                {days}
              </Button>
            ))}
            <Button
              size="sm"
              variant={isCustomDuration ? 'default' : 'outline'}
              onClick={() => {
                if (!isCustomDuration) {
                  onDurationChange(14);
                }
              }}
              className={
                isCustomDuration
                  ? 'bg-[#FF6B35] hover:bg-[#DC2626] border-0'
                  : 'border-[#374151] hover:border-[#FF6B35]'
              }
            >
              Custom
            </Button>
            {isCustomDuration && (
              <Input
                type="number"
                value={duration}
                onChange={(e) => onDurationChange(parseInt(e.target.value) || 7)}
                className="w-20 bg-[#0D0D0D] border-[#374151]"
                min="1"
                max="365"
              />
            )}
            <span className="text-sm text-[#9CA3AF] ml-2">days per cycle</span>
          </div>
        </div>

        {/* Start Date */}
        <div className="md:col-span-2">
          <Label className="text-[#E5E7EB] mb-2">Start Date (optional)</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="bg-[#0D0D0D] border-[#374151] focus:border-[#FF6B35] focus:ring-[#FF6B35]/20"
          />
          <p className="text-xs text-[#6B7280] mt-1">
            Leave blank to start whenever you're ready
          </p>
        </div>
      </div>
    </Card>
  );
}
