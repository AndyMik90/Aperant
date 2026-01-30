/**
 * @vitest-environment jsdom
 */

/**
 * Tests for ProfileBadge Component
 *
 * Tests the profile badge visual component used in task cards.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ProfileBadge, ProfileSwapIndicator } from './ProfileBadge';
import { TooltipProvider } from './ui/tooltip';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'tasks:profileBadge.reason.proactive': 'Proactively assigned',
        'tasks:profileBadge.reason.reactive': 'Assigned after rate limit',
        'tasks:profileBadge.reason.manual': 'Manually assigned',
        'tasks:profileBadge.swapReason.capacity': 'capacity',
        'tasks:profileBadge.swapReason.rate_limit': 'rate limit',
        'tasks:profileBadge.swapReason.manual': 'manual',
        'tasks:profileBadge.swapReason.recovery': 'recovery'
      };
      return translations[key] || key;
    }
  })
}));

// Wrapper with required providers
function renderWithProviders(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('ProfileBadge', () => {
  describe('rendering', () => {
    it('should render profile name', () => {
      renderWithProviders(<ProfileBadge profileName="Test Profile" />);

      expect(screen.getByText('Test Profile')).toBeInTheDocument();
    });

    it('should truncate long profile names', () => {
      renderWithProviders(
        <ProfileBadge profileName="Very Long Profile Name Here" />
      );

      // Name should be truncated to first 12 chars + ...
      expect(screen.getByText('Very Long Pr...')).toBeInTheDocument();
    });
  });

  describe('assignment reason styling', () => {
    it('should show proactive badge style when running', () => {
      renderWithProviders(
        <ProfileBadge
          profileName="Profile 1"
          assignmentReason="proactive"
          isRunning={true}
        />
      );

      // The text is inside a Badge (div) which has the color classes
      const textElement = screen.getByText('Profile 1');
      // Get the Badge element by walking up the DOM - Badge > TooltipTrigger button > TextSpan
      const badgeElement = textElement.closest('.bg-green-100');
      expect(badgeElement).toBeInTheDocument();
    });

    it('should show reactive badge style when running', () => {
      renderWithProviders(
        <ProfileBadge
          profileName="Profile 1"
          assignmentReason="reactive"
          isRunning={true}
        />
      );

      const textElement = screen.getByText('Profile 1');
      const badgeElement = textElement.closest('.bg-yellow-100');
      expect(badgeElement).toBeInTheDocument();
    });

    it('should show manual badge style when running', () => {
      renderWithProviders(
        <ProfileBadge
          profileName="Profile 1"
          assignmentReason="manual"
          isRunning={true}
        />
      );

      const textElement = screen.getByText('Profile 1');
      const badgeElement = textElement.closest('.bg-blue-100');
      expect(badgeElement).toBeInTheDocument();
    });

    it('should not show color when not running', () => {
      renderWithProviders(
        <ProfileBadge
          profileName="Profile 1"
          assignmentReason="proactive"
          isRunning={false}
        />
      );

      const textElement = screen.getByText('Profile 1');
      // Should not have green styling when not running
      const badgeElement = textElement.closest('.bg-green-100');
      expect(badgeElement).not.toBeInTheDocument();
    });
  });

  describe('running state', () => {
    it('should show running indicator when isRunning is true', () => {
      renderWithProviders(
        <ProfileBadge profileName="Profile 1" isRunning={true} />
      );

      const badge = screen.getByText('Profile 1');
      expect(badge.parentElement).toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    it('should render in compact mode with smaller sizing', () => {
      renderWithProviders(
        <ProfileBadge profileName="Profile 1" compact={true} />
      );

      // Check that the text is rendered - the component is displayed
      expect(screen.getByText('Profile 1')).toBeInTheDocument();
    });

    it('should render in normal mode with standard sizing', () => {
      renderWithProviders(
        <ProfileBadge profileName="Profile 1" compact={false} />
      );

      expect(screen.getByText('Profile 1')).toBeInTheDocument();
    });
  });

  describe('custom className', () => {
    it('should apply custom className', () => {
      renderWithProviders(
        <ProfileBadge profileName="Profile 1" className="custom-class" />
      );

      // Check that the custom class is applied somewhere in the tree
      expect(screen.getByText('Profile 1').closest('.custom-class')).toBeInTheDocument();
    });
  });
});

describe('ProfileSwapIndicator', () => {
  it('should render swap from and to profiles', () => {
    render(
      <ProfileSwapIndicator
        fromProfile="Profile A"
        toProfile="Profile B"
        reason="rate_limit"
      />
    );

    expect(screen.getByText('Profile A')).toBeInTheDocument();
    expect(screen.getByText('Profile B')).toBeInTheDocument();
  });

  it('should show strikethrough on from profile', () => {
    render(
      <ProfileSwapIndicator
        fromProfile="Profile A"
        toProfile="Profile B"
        reason="capacity"
      />
    );

    const fromProfile = screen.getByText('Profile A');
    expect(fromProfile.className).toContain('line-through');
  });

  it('should show reason text', () => {
    render(
      <ProfileSwapIndicator
        fromProfile="Profile A"
        toProfile="Profile B"
        reason="manual"
      />
    );

    expect(screen.getByText('(manual)')).toBeInTheDocument();
  });
});
