import { screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/test-utils';
import { RoutinesEnhanced } from '../RoutinesEnhanced';

const mockAuth = vi.hoisted(() => ({
  useAuth: () => ({
    user: { id: 'test-user-id', email: 'test@example.com' },
    session: { user: { id: 'test-user-id' }, access_token: 'test-token' },
    loading: false,
    signOut: () => Promise.resolve(),
  }),
}));

vi.mock('@/app/hooks/useAuth', () => mockAuth);
vi.mock('@/providers/AuthProvider', () => mockAuth);

describe('RoutinesEnhanced', () => {
  it('renders without crashing', () => {
    renderWithProviders(<RoutinesEnhanced onCreateRoutine={vi.fn()} onEditRoutine={vi.fn()} />);
    expect(screen.getAllByText(/my routines/i).length).toBeGreaterThan(0);
  });
});
