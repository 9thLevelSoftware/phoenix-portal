import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/test-utils';
import { TrainingCycles } from '../TrainingCycles';

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

describe('TrainingCycles', () => {
  it('renders without crashing', () => {
    const { container } = renderWithProviders(<TrainingCycles />);
    // Component renders loading skeletons while query is pending
    expect(container.querySelector('.bg-\\[\\#0D0D0D\\]')).toBeInTheDocument();
  });
});
