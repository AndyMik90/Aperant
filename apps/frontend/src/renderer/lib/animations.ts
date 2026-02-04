/**
 * UX-4: Micro-animations presets for smooth polish and feedback.
 *
 * This module provides animation utilities for:
 * - Card entrance animations
 * - Status transitions
 * - Button interactions
 * - Modal open/close
 * - Terminal output fade-in
 */

// CSS transition duration values
export const ANIMATION_DURATION = {
  fast: 150,
  normal: 200,
  slow: 300,
  verySlow: 500,
} as const;

// CSS timing functions
export const ANIMATION_EASING = {
  easeOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
} as const;

// Tailwind animation class presets
export const ANIMATION_CLASSES = {
  // Entrance animations
  fadeIn: 'animate-in fade-in duration-200',
  fadeInUp: 'animate-in fade-in slide-in-from-bottom-2 duration-200',
  fadeInDown: 'animate-in fade-in slide-in-from-top-2 duration-200',
  fadeInLeft: 'animate-in fade-in slide-in-from-left-2 duration-200',
  fadeInRight: 'animate-in fade-in slide-in-from-right-2 duration-200',

  // Exit animations
  fadeOut: 'animate-out fade-out duration-150',
  fadeOutUp: 'animate-out fade-out slide-out-to-top-2 duration-150',
  fadeOutDown: 'animate-out fade-out slide-out-to-bottom-2 duration-150',

  // Scale animations
  scaleIn: 'animate-in zoom-in-95 duration-200',
  scaleOut: 'animate-out zoom-out-95 duration-150',

  // Combined modal animation
  modalEnter: 'animate-in fade-in zoom-in-95 duration-200',
  modalExit: 'animate-out fade-out zoom-out-95 duration-150',

  // Card animations
  cardEnter: 'animate-in fade-in slide-in-from-bottom-2 duration-300',
  cardHover: 'transition-transform duration-150 hover:scale-[1.01]',

  // Button animations
  buttonPress: 'active:scale-[0.98] transition-transform duration-75',
  buttonHover: 'transition-all duration-150 hover:brightness-110',

  // Status badge color transition
  statusTransition: 'transition-colors duration-300',

  // Progress bar fill animation
  progressFill: 'transition-all duration-500 ease-out',

  // Pulse animation for loading states
  pulse: 'animate-pulse',

  // Notification slide-in
  notificationEnter: 'animate-in slide-in-from-right-full fade-in duration-300',
  notificationExit: 'animate-out slide-out-to-right-full fade-out duration-200',

  // Terminal line fade-in
  terminalLine: 'animate-in fade-in duration-150',
} as const;

// Stagger delay calculator for list animations
export function getStaggerDelay(index: number, baseDelay = 50, maxDelay = 300): number {
  return Math.min(index * baseDelay, maxDelay);
}

// Generate stagger style for inline use
export function getStaggerStyle(index: number, baseDelay = 50): React.CSSProperties {
  return {
    animationDelay: `${getStaggerDelay(index, baseDelay)}ms`,
  };
}

// Intersection observer hook configuration for scroll animations
export const INTERSECTION_OPTIONS = {
  threshold: 0.1,
  rootMargin: '50px',
} as const;
