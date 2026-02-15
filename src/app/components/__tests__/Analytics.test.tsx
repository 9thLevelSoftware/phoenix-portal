import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Analytics } from '../Analytics';

describe('Analytics', () => {
  it('renders without crashing', () => {
    render(<Analytics />);
    expect(screen.getByText(/analytics hub/i)).toBeInTheDocument();
  });
});
