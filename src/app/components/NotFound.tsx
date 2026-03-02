import { Flame } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/app/components/ui/button";

export function NotFound() {
	return (
		<div className="min-h-[60vh] flex items-center justify-center p-8">
			<div className="text-center max-w-md">
				<Flame className="w-16 h-16 text-primary mx-auto mb-4 opacity-50" />
				<h1 className="text-4xl font-bold text-white mb-2">404</h1>
				<h2 className="text-lg font-medium text-white mb-2">Page Not Found</h2>
				<p className="text-muted-foreground mb-6 text-sm">
					The page you're looking for doesn't exist or has been moved.
				</p>
				<Button asChild>
					<Link to="/dashboard">Back to Dashboard</Link>
				</Button>
			</div>
		</div>
	);
}
