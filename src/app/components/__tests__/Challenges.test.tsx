import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Challenges } from '../Challenges';

describe('Challenges', () => {
  it('renders without crashing', () => {
    render(<Challenges />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/challenges/i);
  });
});
