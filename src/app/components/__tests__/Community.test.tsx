import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Community } from '../Community';

describe('Community', () => {
  it('renders without crashing', () => {
    render(<Community />);
    expect(screen.getByText(/community hub/i)).toBeInTheDocument();
  });
});
