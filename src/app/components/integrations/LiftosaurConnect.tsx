import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Dumbbell, Key } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

interface LiftosaurConnectProps {
	userId: string;
	isConnected?: boolean;
	onDisconnect?: () => void;
}

/**
 * Liftosaur connection component — API key auth only.
 * Requires Liftosaur Premium subscription for API access.
 * API key format: lftsk_*
 */
export function LiftosaurConnect({
	userId,
	isConnected,
	onDisconnect,
}: LiftosaurConnectProps) {
	const queryClient = useQueryClient();

	const [apiKey, setApiKey] = useState("");
	const [isSavingKey, setIsSavingKey] = useState(false);
	const [isTesting, setIsTesting] = useState(false);

	const handleSaveApiKey = useCallback(async () => {
		if (!apiKey.trim()) {
			toast.error("Please enter your Liftosaur API key");
			return;
		}

		setIsSavingKey(true);
		try {
			const { error } = await supabase.functions.invoke(
				"liftosaur-sync",
				{
					body: { user_id: userId, api_key: apiKey.trim() },
				},
			);

			if (error) throw error;

			toast.success(
				"Liftosaur API key saved and initial sync started",
			);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.integrations.byUser(userId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.integrations.external(userId),
				}),
			]);
			setApiKey("");
		} catch (err) {
			toast.error(
				err instanceof Error
					? err.message
					: "Failed to save API key",
			);
		} finally {
			setIsSavingKey(false);
		}
	}, [apiKey, queryClient, userId]);

	const handleTestConnection = useCallback(async () => {
		setIsTesting(true);
		try {
			const { data, error } = await supabase.functions.invoke(
				"liftosaur-sync",
				{
					body: { user_id: userId, sync_type: "manual" },
				},
			);

			if (error) throw error;

			if (data?.requires_premium) {
				toast.error(
					"Liftosaur Premium subscription required for API access",
				);
			} else if (data?.success) {
				toast.success(
					`Connection verified. ${data.imported} workouts synced.`,
				);
				await queryClient.invalidateQueries({
					queryKey: queryKeys.integrations.external(userId),
				});
			} else {
				toast.info("Connection test completed");
			}
		} catch (err) {
			toast.error(
				err instanceof Error
					? err.message
					: "Connection test failed",
			);
		} finally {
			setIsTesting(false);
		}
	}, [queryClient, userId]);

	return (
		<Card className="border-border/50">
			<CardHeader>
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center size-10 rounded-lg bg-[#8B5CF6]/10">
						<Dumbbell className="size-5 text-[#8B5CF6]" />
					</div>
					<div className="flex-1">
						<CardTitle className="text-base">
							Liftosaur
						</CardTitle>
						<CardDescription>
							Scriptable workout tracking
						</CardDescription>
					</div>
					{isConnected && (
						<div className="flex items-center gap-2">
							<span className="text-xs text-[var(--color-forge-green)] flex items-center gap-1">
								<CheckCircle className="size-3" />
								Connected
							</span>
							{onDisconnect && (
								<Button
									variant="ghost"
									size="sm"
									onClick={onDisconnect}
								>
									Disconnect
								</Button>
							)}
						</div>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-start gap-2 rounded-md bg-purple-500/10 p-3 text-sm">
					<AlertCircle className="size-4 text-purple-500 shrink-0 mt-0.5" />
					<p className="text-muted-foreground">
						Requires{" "}
						<span className="font-medium text-purple-500">
							Liftosaur Premium
						</span>
						. Create an API key in Liftosaur Settings &rarr;
						API Keys.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="liftosaur-api-key">
						<Key className="size-3.5 inline mr-1.5" />
						API Key
					</Label>
					<Input
						id="liftosaur-api-key"
						type="password"
						placeholder="lftsk_..."
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
					/>
				</div>

				<div className="flex gap-2">
					<Button
						onClick={handleSaveApiKey}
						disabled={isSavingKey || !apiKey.trim()}
						size="sm"
					>
						{isSavingKey ? "Saving..." : "Save & Sync"}
					</Button>
					{isConnected && (
						<Button
							onClick={handleTestConnection}
							disabled={isTesting}
							variant="outline"
							size="sm"
						>
							{isTesting ? "Testing..." : "Test Connection"}
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
