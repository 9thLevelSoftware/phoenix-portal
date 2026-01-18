import { motion } from 'motion/react';
import { cn } from './utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-lg bg-[#1a1a1a]', className)}
      {...props}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-[#374151]/30 to-transparent"
        animate={{
          x: ['-100%', '100%'],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'linear',
        }}
      />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border border-[#374151] rounded-lg">
      <div className="space-y-3">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex gap-2 mt-4">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    </div>
  );
}

export function RoutineCardSkeleton() {
  return (
    <div className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border border-[#374151] rounded-lg">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>

        <div className="flex gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>

        <div className="flex gap-2">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>

        <div className="flex gap-2 pt-4 border-t border-[#374151]">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 flex-1" />
        </div>
      </div>
    </div>
  );
}

export function WorkoutCardSkeleton() {
  return (
    <div className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border border-[#374151] rounded-lg">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border border-[#374151] rounded-lg">
      <Skeleton className="h-4 w-20 mb-3" />
      <Skeleton className="h-8 w-24 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="p-6 bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border border-[#374151] rounded-lg">
      <Skeleton className="h-6 w-48 mb-6" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-end gap-2 h-32">
            {Array.from({ length: 7 }).map((_, j) => (
              <Skeleton
                key={j}
                className="flex-1"
                style={{ height: `${Math.random() * 100 + 20}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="border border-[#374151] rounded-lg overflow-hidden">
      <div className="bg-[#1a1a1a] p-4 border-b border-[#374151]">
        <div className="flex gap-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-4 border-b border-[#374151] last:border-0">
          <div className="flex gap-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
