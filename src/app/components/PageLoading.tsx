export function PageLoading() {
	return (
		<div className="flex-1 flex items-center justify-center h-[calc(100vh-4rem)]">
			<div className="flex flex-col items-center gap-4">
				<div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
				<p className="text-muted-foreground text-sm">Loading...</p>
			</div>
		</div>
	);
}
