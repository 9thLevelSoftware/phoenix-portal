import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { supabase } from "@/lib/supabase";
import { PhoenixLogo } from "./PhoenixLogo";

export function ResetPassword() {
	const navigate = useNavigate();
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		if (newPassword.length < 8) {
			setError("Password must be at least 8 characters");
			return;
		}

		if (newPassword !== confirmPassword) {
			setError("Passwords do not match");
			return;
		}

		setLoading(true);
		try {
			const { error: updateError } = await supabase.auth.updateUser({
				password: newPassword,
			});
			if (updateError) {
				toast.error(updateError.message);
			} else {
				toast.success("Password updated successfully");
				navigate("/dashboard");
			}
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen bg-background flex items-center justify-center px-4">
			<Card className="w-full max-w-md p-8 bg-surface-2 border-secondary">
				<div className="flex items-center justify-center gap-2 mb-8">
					<PhoenixLogo size="sm" animated={false} />
					<span className="text-xl text-primary font-semibold">
						Project Phoenix
					</span>
				</div>

				<div className="text-center mb-6">
					<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary/20 to-chart-2/20 flex items-center justify-center">
						<Lock className="w-6 h-6 text-primary" />
					</div>
					<h1 className="text-2xl font-semibold text-white mb-1">
						Set new password
					</h1>
					<p className="text-sm text-muted-foreground">
						Choose a strong password for your account
					</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="new-password" className="text-secondary-foreground">
							New Password
						</Label>
						<Input
							id="new-password"
							type="password"
							placeholder="At least 8 characters"
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							className="bg-background border-secondary text-white placeholder:text-muted"
						/>
					</div>

					<div className="space-y-2">
						<Label
							htmlFor="confirm-password"
							className="text-secondary-foreground"
						>
							Confirm Password
						</Label>
						<Input
							id="confirm-password"
							type="password"
							placeholder="Confirm your new password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							className="bg-background border-secondary text-white placeholder:text-muted"
						/>
					</div>

					{error && <p className="text-sm text-red-400">{error}</p>}

					<Button
						type="submit"
						disabled={loading}
						className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
					>
						{loading ? (
							<Loader2 className="w-4 h-4 animate-spin mr-2" />
						) : (
							<Lock className="w-4 h-4 mr-2" />
						)}
						Update Password
					</Button>
				</form>
			</Card>
		</div>
	);
}
