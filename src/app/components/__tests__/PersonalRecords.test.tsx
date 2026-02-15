import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PersonalRecords } from '../PersonalRecords';

describe('PersonalRecords', () => {
  it('renders without crashing', () => {
    render(<PersonalRecords />);
    expect(screen.getByText(/personal records/i)).toBeInTheDocument();
  });
});
