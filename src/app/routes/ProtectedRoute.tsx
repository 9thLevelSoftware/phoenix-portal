import { Navigate, Outlet } from "react-router";
import { PageLoading } from "@/app/components/PageLoading";
import { useAuth } from "@/app/hooks/useAuth";

export function ProtectedRoute() {
	const { user, loading } = useAuth();

	if (loading) {
		return <PageLoading />;
	}

	if (!user) {
		return <Navigate to="/" replace />;
	}

	return <Outlet />;
}
