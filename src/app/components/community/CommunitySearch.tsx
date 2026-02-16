import { useState, useEffect } from 'react';
import { Input } from '@/app/components/ui/input';
import { Search, X } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { useCommunityStore } from '@/stores/useCommunityStore';

export function CommunitySearch() {
  const activeTab = useCommunityStore((s) => s.activeTab);
  const setSearch = useCommunityStore((s) => s.setSearch);

  const [localValue, setLocalValue] = useState('');
  const debouncedValue = useDebounce(localValue, 300);

  useEffect(() => {
    setSearch(debouncedValue);
  }, [debouncedValue, setSearch]);

  const placeholder =
    activeTab === 'routines' ? 'Search routines...' : 'Search cycles...';

  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
      <Input
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-8 bg-[#1a1a1a] border-[#374151] text-white placeholder:text-[#6B7280]"
      />
      {localValue && (
        <button
          onClick={() => setLocalValue('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
