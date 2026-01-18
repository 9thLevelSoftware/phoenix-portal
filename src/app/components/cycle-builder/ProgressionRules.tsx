import { Card } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Switch } from '@/app/components/ui/switch';
import { TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { ProgressionConfig, DeloadConfig } from './types';

interface ProgressionRulesProps {
  progressionType: 'percentage' | 'fixed' | 'manual';
  progressionConfig: ProgressionConfig;
  deloadEnabled: boolean;
  deloadConfig?: DeloadConfig;
  onProgressionTypeChange: (type: 'percentage' | 'fixed' | 'manual') => void;
  onProgressionConfigChange: (config: ProgressionConfig) => void;
  onDeloadEnabledChange: (enabled: boolean) => void;
  onDeloadConfigChange: (config: DeloadConfig) => void;
}

export function ProgressionRules({
  progressionType,
  progressionConfig,
  deloadEnabled,
  deloadConfig,
  onProgressionTypeChange,
  onProgressionConfigChange,
  onDeloadEnabledChange,
  onDeloadConfigChange,
}: ProgressionRulesProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const currentDeload = deloadConfig || {
    frequencyWeeks: 4,
    intensityPercent: 60,
    volumePercent: 50,
  };

  return (
    <Card className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151]">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between mb-6 group"
      >
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[#FF6B35]" />
          Progression Rules
        </h2>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-[#9CA3AF] group-hover:text-white transition-colors" />
        ) : (
          <ChevronDown className="w-5 h-5 text-[#9CA3AF] group-hover:text-white transition-colors" />
        )}
      </button>

      {isExpanded && (
        <div className="space-y-6">
          {/* Type Selection */}
          <div>
            <Label className="text-[#E5E7EB] mb-3">How should weights progress over time?</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ProgressionTypeCard
                title="📈 Percentage Increase"
                isSelected={progressionType === 'percentage'}
                onClick={() => onProgressionTypeChange('percentage')}
              />
              <ProgressionTypeCard
                title="➕ Fixed Weight Increase"
                isSelected={progressionType === 'fixed'}
                onClick={() => onProgressionTypeChange('fixed')}
              />
              <ProgressionTypeCard
                title="✋ Manual (None)"
                isSelected={progressionType === 'manual'}
                onClick={() => onProgressionTypeChange('manual')}
              />
            </div>
          </div>

          <div className="border-t border-[#374151] pt-6">
            {/* Percentage Settings */}
            {progressionType === 'percentage' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-white">Percentage Increase Settings</h3>

                <div>
                  <Label className="text-[#9CA3AF] mb-2">Increase all weights by:</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          percentageIncrease: Math.max(0, (progressionConfig.percentageIncrease || 2.5) - 0.5),
                        })
                      }
                      className="border-[#374151]"
                    >
                      −
                    </Button>
                    <Input
                      type="number"
                      step="0.5"
                      value={progressionConfig.percentageIncrease || 2.5}
                      onChange={(e) =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          percentageIncrease: parseFloat(e.target.value) || 2.5,
                        })
                      }
                      className="text-center bg-[#0D0D0D] border-[#374151]"
                    />
                    <span className="text-[#9CA3AF]">%</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          percentageIncrease: (progressionConfig.percentageIncrease || 2.5) + 0.5,
                        })
                      }
                      className="border-[#374151]"
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-[#9CA3AF] mb-2">Every:</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          cycleFrequency: Math.max(1, (progressionConfig.cycleFrequency || 1) - 1),
                        })
                      }
                      className="border-[#374151]"
                    >
                      −
                    </Button>
                    <Input
                      type="number"
                      value={progressionConfig.cycleFrequency || 1}
                      onChange={(e) =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          cycleFrequency: parseInt(e.target.value) || 1,
                        })
                      }
                      className="text-center bg-[#0D0D0D] border-[#374151]"
                    />
                    <span className="text-[#9CA3AF]">cycle(s)</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          cycleFrequency: (progressionConfig.cycleFrequency || 1) + 1,
                        })
                      }
                      className="border-[#374151]"
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-[#9CA3AF] mb-3">Trigger progression when:</Label>
                  <div className="space-y-2">
                    <TriggerOption
                      label="All sets completed successfully"
                      isSelected={progressionConfig.trigger === 'all_sets'}
                      onClick={() =>
                        onProgressionConfigChange({ ...progressionConfig, trigger: 'all_sets' })
                      }
                    />
                    <TriggerOption
                      label="Target RPE achieved (recommended)"
                      isSelected={progressionConfig.trigger === 'target_rpe'}
                      onClick={() =>
                        onProgressionConfigChange({ ...progressionConfig, trigger: 'target_rpe' })
                      }
                    />
                    <TriggerOption
                      label="Cycle completed (regardless of performance)"
                      isSelected={progressionConfig.trigger === 'cycle_complete'}
                      onClick={() =>
                        onProgressionConfigChange({ ...progressionConfig, trigger: 'cycle_complete' })
                      }
                    />
                  </div>
                </div>

                <div className="p-4 bg-[#0D0D0D] border border-[#374151] rounded-lg">
                  <div className="text-sm text-[#9CA3AF]">
                    <span className="text-[#F59E0B]">💡 EXAMPLE</span>
                    <br />
                    If you're lifting 80kg and complete the cycle successfully, next cycle will use 82kg (+
                    {progressionConfig.percentageIncrease || 2.5}%)
                  </div>
                </div>
              </div>
            )}

            {/* Fixed Weight Settings */}
            {progressionType === 'fixed' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-white">Fixed Weight Increase Settings</h3>

                <div>
                  <Label className="text-[#9CA3AF] mb-2">Upper body exercises:</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          upperBodyIncrement: Math.max(0, (progressionConfig.upperBodyIncrement || 2.5) - 0.5),
                        })
                      }
                      className="border-[#374151]"
                    >
                      −
                    </Button>
                    <span className="text-[#9CA3AF]">+</span>
                    <Input
                      type="number"
                      step="0.5"
                      value={progressionConfig.upperBodyIncrement || 2.5}
                      onChange={(e) =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          upperBodyIncrement: parseFloat(e.target.value) || 2.5,
                        })
                      }
                      className="text-center bg-[#0D0D0D] border-[#374151]"
                    />
                    <span className="text-[#9CA3AF]">kg per cycle</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          upperBodyIncrement: (progressionConfig.upperBodyIncrement || 2.5) + 0.5,
                        })
                      }
                      className="border-[#374151]"
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-[#9CA3AF] mb-2">Lower body exercises:</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          lowerBodyIncrement: Math.max(0, (progressionConfig.lowerBodyIncrement || 5.0) - 0.5),
                        })
                      }
                      className="border-[#374151]"
                    >
                      −
                    </Button>
                    <span className="text-[#9CA3AF]">+</span>
                    <Input
                      type="number"
                      step="0.5"
                      value={progressionConfig.lowerBodyIncrement || 5.0}
                      onChange={(e) =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          lowerBodyIncrement: parseFloat(e.target.value) || 5.0,
                        })
                      }
                      className="text-center bg-[#0D0D0D] border-[#374151]"
                    />
                    <span className="text-[#9CA3AF]">kg per cycle</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onProgressionConfigChange({
                          ...progressionConfig,
                          lowerBodyIncrement: (progressionConfig.lowerBodyIncrement || 5.0) + 0.5,
                        })
                      }
                      className="border-[#374151]"
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div className="p-4 bg-[#0D0D0D] border border-[#374151] rounded-lg">
                  <div className="text-sm text-[#9CA3AF]">
                    <span className="text-[#F59E0B]">💡 Based on 5/3/1 methodology</span>
                    <br />
                    Upper body uses smaller increments because those muscle groups progress slower.
                  </div>
                </div>
              </div>
            )}

            {/* Manual Settings */}
            {progressionType === 'manual' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-white">Manual Progression</h3>
                <p className="text-[#9CA3AF]">
                  Weights will not automatically increase between cycles. You can manually adjust weights in each
                  workout.
                </p>
                <div className="p-4 bg-[#0D0D0D] border border-[#374151] rounded-lg">
                  <div className="text-sm text-[#9CA3AF]">
                    <span className="text-[#F59E0B]">💡 Tip</span>
                    <br />
                    Choose this if you prefer to manage progression yourself or if this is a maintenance/deload
                    cycle.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Deload Configuration */}
          <div className="pt-6 border-t border-[#374151]">
            <h3 className="font-semibold text-white mb-4">Deload Weeks</h3>

            <div className="flex items-center gap-2 mb-4">
              <Switch checked={deloadEnabled} onCheckedChange={onDeloadEnabledChange} />
              <Label className="text-[#E5E7EB]">Include scheduled deload weeks</Label>
            </div>

            {deloadEnabled && (
              <div className="space-y-4 pl-8">
                <div>
                  <Label className="text-[#9CA3AF] mb-2">Deload every:</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={currentDeload.frequencyWeeks}
                      onChange={(e) =>
                        onDeloadConfigChange({
                          ...currentDeload,
                          frequencyWeeks: parseInt(e.target.value) || 4,
                        })
                      }
                      className="w-24 bg-[#0D0D0D] border-[#374151]"
                      min="1"
                    />
                    <span className="text-[#9CA3AF]">weeks</span>
                  </div>
                </div>

                <div>
                  <Label className="text-[#9CA3AF] mb-2">During deload:</Label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#9CA3AF] w-24">Intensity:</span>
                      <Input
                        type="number"
                        value={currentDeload.intensityPercent}
                        onChange={(e) =>
                          onDeloadConfigChange({
                            ...currentDeload,
                            intensityPercent: parseInt(e.target.value) || 60,
                          })
                        }
                        className="w-24 bg-[#0D0D0D] border-[#374151]"
                        min="0"
                        max="100"
                      />
                      <span className="text-[#9CA3AF]">% of working weight</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#9CA3AF] w-24">Volume:</span>
                      <Input
                        type="number"
                        value={currentDeload.volumePercent}
                        onChange={(e) =>
                          onDeloadConfigChange({
                            ...currentDeload,
                            volumePercent: parseInt(e.target.value) || 50,
                          })
                        }
                        className="w-24 bg-[#0D0D0D] border-[#374151]"
                        min="0"
                        max="100"
                      />
                      <span className="text-[#9CA3AF]">% of normal sets</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[#0D0D0D] border border-[#374151] rounded-lg">
                  <div className="text-sm text-[#9CA3AF]">
                    <span className="text-[#F59E0B]">💡 Why deload?</span>
                    <br />
                    Deload weeks help prevent overtraining and allow your body to recover. Most programs recommend
                    every 4-6 weeks of hard training.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function ProgressionTypeCard({
  title,
  isSelected,
  onClick,
}: {
  title: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-lg border-2 transition-all ${
        isSelected
          ? 'border-[#FF6B35] bg-[#FF6B35]/10'
          : 'border-[#374151] hover:border-[#FF6B35]/50 bg-[#0D0D0D]'
      }`}
    >
      <div className="text-center">
        <div className="font-semibold text-white mb-2">{title}</div>
        <div className="text-sm text-[#9CA3AF]">
          {isSelected ? '● Selected' : '○'}
        </div>
      </div>
    </button>
  );
}

function TriggerOption({
  label,
  isSelected,
  onClick,
}: {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <label className="flex items-start gap-3 p-3 bg-[#0D0D0D] border border-[#374151] rounded-lg cursor-pointer hover:border-[#FF6B35] transition-colors">
      <input type="radio" checked={isSelected} onChange={onClick} className="mt-1" />
      <span className="text-white">{label}</span>
    </label>
  );
}
