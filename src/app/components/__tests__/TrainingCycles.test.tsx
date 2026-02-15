import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TrainingCycles } from '../TrainingCycles';

describe('TrainingCycles', () => {
  it('renders without crashing', () => {
    render(<TrainingCycles onCreateCycle={vi.fn()} onEditCycle={vi.fn()} />);
    expect(screen.getByText(/training cycles/i)).toBeInTheDocument();
  });
});
