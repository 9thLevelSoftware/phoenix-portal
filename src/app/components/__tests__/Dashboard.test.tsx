import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Dashboard } from '../Dashboard';

describe('Dashboard', () => {
  it('renders without crashing', () => {
    render(<Dashboard />);
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  });
});
