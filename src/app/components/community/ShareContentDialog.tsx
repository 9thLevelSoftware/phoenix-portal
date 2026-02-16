import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Label } from '@/app/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { Badge } from '@/app/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Share2, Check, X } from 'lucide-react';
import { useShareContent } from '@/mutations/community';
import { cn } from '@/lib/utils';

const MUSCLE_GROUP_TAGS = [
  'Chest',
  'Back',
  'Shoulders',
  'Arms',
  'Legs',
  'Core',
  'Full Body',
] as const;

const DIFFICULTY_OPTIONS = ['Beginner', 'Intermediate', 'Advanced'] as const;

// Minimal source item shape for the selector
interface SourceItem {
  id: string;
  name: string;
  exercise_count?: number;
  estimated_duration?: number;
  exercises_snapshot?: unknown;
  duration_weeks?: number;
}

interface ShareContentDialogProps {
  /** User's own routines available to share */
  routines?: SourceItem[];
  /** User's own cycles available to share */
  cycles?: SourceItem[];
  /** Optional trigger element (defaults to Share button) */
  trigger?: React.ReactNode;
}

export function ShareContentDialog({
  routines = [],
  cycles = [],
  trigger,
}: ShareContentDialogProps) {
  const [open, setOpen] = useState(false);
  const [contentType, setContentType] = useState<'routine' | 'cycle'>('routine');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState(false);

  const shareContent = useShareContent();

  const sourceItems = contentType === 'routine' ? routines : cycles;
  const selectedSource = sourceItems.find((item) => item.id === selectedSourceId);

  // Auto-populate name from source when selected
  useEffect(() => {
    if (selectedSource) {
      setName(selectedSource.name);
    }
  }, [selectedSource]);

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const resetForm = () => {
    setSelectedSourceId('');
    setName('');
    setDescription('');
    setTags([]);
    setDifficulty('');
    setShowSuccess(false);
  };

  const handleSubmit = () => {
    if (!selectedSourceId || !name || !difficulty) return;

    shareContent.mutate(
      {
        type: contentType,
        sourceId: selectedSourceId,
        name,
        description,
        tags,
        difficulty: difficulty as 'Beginner' | 'Intermediate' | 'Advanced',
        exerciseCount: selectedSource?.exercise_count,
        estimatedDuration: selectedSource?.estimated_duration,
        exercisesSnapshot:
          contentType === 'routine' ? selectedSource?.exercises_snapshot : undefined,
        durationWeeks:
          contentType === 'cycle' ? selectedSource?.duration_weeks : undefined,
      },
      {
        onSuccess: () => {
          setShowSuccess(true);
          setTimeout(() => {
            setOpen(false);
            resetForm();
          }, 1200);
        },
      }
    );
  };

  const isFormValid = selectedSourceId && name.trim() && difficulty;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share to Community</DialogTitle>
          <DialogDescription>
            Share your {contentType} with the Phoenix community.
          </DialogDescription>
        </DialogHeader>

        {showSuccess ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#10B981]/20">
              <Check className="h-6 w-6 text-[#10B981]" />
            </div>
            <p className="text-sm text-muted-foreground">
              Successfully shared to community!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Content type toggle */}
            <div className="space-y-2">
              <Label>Content Type</Label>
              <Tabs
                value={contentType}
                onValueChange={(v) => {
                  setContentType(v as 'routine' | 'cycle');
                  setSelectedSourceId('');
                  setName('');
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="routine" className="flex-1">
                    Routine
                  </TabsTrigger>
                  <TabsTrigger value="cycle" className="flex-1">
                    Cycle
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Source selector */}
            <div className="space-y-2">
              <Label>
                Select {contentType === 'routine' ? 'Routine' : 'Cycle'}
              </Label>
              <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={`Choose a ${contentType} to share...`}
                  />
                </SelectTrigger>
                <SelectContent>
                  {sourceItems.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No {contentType}s available
                    </SelectItem>
                  ) : (
                    sourceItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {selectedSource && contentType === 'routine' && (
                <p className="text-xs text-muted-foreground">
                  {selectedSource.exercise_count ?? 0} exercises
                  {selectedSource.estimated_duration
                    ? ` / ~${selectedSource.estimated_duration} min`
                    : ''}
                </p>
              )}
              {selectedSource && contentType === 'cycle' && (
                <p className="text-xs text-muted-foreground">
                  {selectedSource.duration_weeks ?? 0} weeks
                </p>
              )}
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label>Name</Label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Give it a catchy name..."
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your routine, goals, who it's best for..."
                rows={3}
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Muscle Groups</Label>
              <div className="flex flex-wrap gap-2">
                {MUSCLE_GROUP_TAGS.map((tag) => {
                  const isSelected = tags.includes(tag);
                  return (
                    <Badge
                      key={tag}
                      variant={isSelected ? 'default' : 'outline'}
                      className={cn(
                        'cursor-pointer select-none transition-colors',
                        isSelected &&
                          'bg-[#FF6B35] hover:bg-[#FF6B35]/80 text-white'
                      )}
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                      {isSelected && <X className="ml-1 h-3 w-3" />}
                    </Badge>
                  );
                })}
              </div>
            </div>

            {/* Difficulty */}
            <div className="space-y-2">
              <Label>Difficulty</Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger>
                  <SelectValue placeholder="Select difficulty..." />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTY_OPTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Submit */}
            <Button
              className="w-full bg-[#FF6B35] hover:bg-[#FF6B35]/90 text-white"
              onClick={handleSubmit}
              disabled={!isFormValid || shareContent.isPending}
            >
              {shareContent.isPending ? 'Sharing...' : 'Share to Community'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
