import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WorkoutHistory } from '../WorkoutHistory';

describe('WorkoutHistory', () => {
  it('renders without crashing', () => {
    render(<WorkoutHistory onViewSession={vi.fn()} />);
    expect(screen.getByText(/workout history/i)).toBeInTheDocument();
  });
});
