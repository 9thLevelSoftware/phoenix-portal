import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RoutinesEnhanced } from '../RoutinesEnhanced';

describe('RoutinesEnhanced', () => {
  it('renders without crashing', () => {
    render(<RoutinesEnhanced onCreateRoutine={vi.fn()} onEditRoutine={vi.fn()} />);
    expect(screen.getAllByText(/my routines/i).length).toBeGreaterThan(0);
  });
});
