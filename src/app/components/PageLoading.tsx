export function PageLoading() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
        <p className="text-[#9CA3AF] text-sm">Loading...</p>
      </div>
    </div>
  );
}
