import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LandingPage } from '../LandingPage';

describe('LandingPage', () => {
  it('renders without crashing', () => {
    render(<LandingPage onGetStarted={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/project phoenix/i);
  });
});
