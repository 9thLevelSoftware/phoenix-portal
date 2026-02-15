import { Navigate, Outlet } from 'react-router';
import { useAuth } from '@/app/hooks/useAuth';
import { PageLoading } from '@/app/components/PageLoading';

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
