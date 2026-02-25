/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ModelSearchableSelect component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import '../../../shared/i18n';
import { ModelSearchableSelect } from './ModelSearchableSelect';
import { useSettingsStore } from '../../stores/settings-store';

// Mock the settings store
vi.mock('../../stores/settings-store');

describe('ModelSearchableSelect', () => {
  const mockDiscoverModels = vi.fn();
  const mockOnChange = vi.fn();


  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useSettingsStore).mockImplementation((selector?: (state: any) => any): any => {
      const state = { discoverModels: mockDiscoverModels };
      return selector ? selector(state) : state;
    });
  });

  it('should render input with placeholder', () => {
    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
        placeholder="Select a model"
      />
    );

    expect(screen.getByPlaceholderText('Select a model')).toBeInTheDocument();
  });

  it('should render with initial value', () => {
    render(
      <ModelSearchableSelect
        value="claude-sonnet-4-5-20250929"
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByDisplayValue('claude-sonnet-4-5-20250929');
    expect(input).toBeInTheDocument();
  });

  it('should fetch models when dropdown opens', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    // Click to open dropdown
    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(mockDiscoverModels).toHaveBeenCalledWith(
        'https://api.anthropic.com',
        'sk-test-key-12chars',
        expect.any(AbortSignal)
      );
    });
  });

  it('should display loading state while fetching', async () => {
    mockDiscoverModels.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      // Component shows a Loader2 spinner with animate-spin class
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  it('should display fetched models in dropdown', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
      expect(screen.getByText('claude-sonnet-4-5-20250929')).toBeInTheDocument();
    });
  });

  it('should render dropdown above the input', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByTestId('model-select-dropdown')).toBeInTheDocument();
    });

    const dropdown = screen.getByTestId('model-select-dropdown');
    expect(dropdown).toHaveClass('bottom-full');
  });

  it('should select model and close dropdown', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      const modelButton = screen.getByText('Claude Sonnet 4.5');
      fireEvent.click(modelButton);
    });

    expect(mockOnChange).toHaveBeenCalledWith('claude-sonnet-4-5-20250929');
  });

  it('should allow manual text input', async () => {
    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.change(input, { target: { value: 'custom-model-name' } });

    expect(mockOnChange).toHaveBeenCalledWith('custom-model-name');
  });

  it('should filter models based on search query', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
      { id: 'claude-3-opus-20240229', display_name: 'Claude Opus 3' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    // Wait for models to load
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
    });

    // Type search query
    const searchInput = screen.getByPlaceholderText('Search models...');
    fireEvent.change(searchInput, { target: { value: 'haiku' } });

    // Should only show Haiku
    await waitFor(() => {
      expect(screen.getByText('Claude Haiku 4.5')).toBeInTheDocument();
      expect(screen.queryByText('Claude Sonnet 4.5')).not.toBeInTheDocument();
      expect(screen.queryByText('Claude Opus 3')).not.toBeInTheDocument();
    });
  });

  it('should show fallback mode on fetch failure', async () => {
    mockDiscoverModels.mockRejectedValue(
      new Error('This API endpoint does not support model listing')
    );

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://custom-api.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      // Component falls back to manual input mode with info message
      expect(screen.getByText(/Model discovery not available/)).toBeInTheDocument();
    });
  });

  it('should close dropdown when no models returned', async () => {
    mockDiscoverModels.mockResolvedValue([]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      // Component closes dropdown when no models, dropdown should not be visible
      expect(screen.queryByPlaceholderText('Search models...')).not.toBeInTheDocument();
    });
  });

  it('should show no results message when search does not match', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
    });

    // Search for non-existent model
    const searchInput = screen.getByPlaceholderText('Search models...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    await waitFor(() => {
      expect(screen.getByText('No models match your search')).toBeInTheDocument();
    });
  });

  it('should be disabled when disabled prop is true', () => {
    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
        disabled={true}
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    expect(input).toBeDisabled();
  });

  it('should highlight selected model', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value="claude-sonnet-4-5-20250929"
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByDisplayValue('claude-sonnet-4-5-20250929');
    fireEvent.focus(input);

    await waitFor(() => {
      // Selected model should have Check icon indicator (via background color)
      const sonnetButton = screen.getByText('Claude Sonnet 4.5').closest('button');
      expect(sonnetButton).toHaveClass('bg-accent');
    });
  });

  it('should close dropdown when clicking outside', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
    ]);

    render(
      <div>
        <ModelSearchableSelect
          value=""
          onChange={mockOnChange}
          baseUrl="https://api.anthropic.com"
          apiKey="sk-test-key-12chars"
        />
        <div data-testid="outside-element">Outside</div>
      </div>
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
    });

    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside-element'));

    await waitFor(() => {
      expect(screen.queryByText('Claude Sonnet 4.5')).not.toBeInTheDocument();
    });
  });
});
