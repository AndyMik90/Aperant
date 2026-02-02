/**
 * Ideation-related constants
 * Types, categories, and configuration for AI-generated project improvements
 */

import type { TFunction } from 'i18next';

// Type alias for translation function
type TranslationFunction = TFunction;

// ============================================
// Ideation Types
// ============================================

// Ideation type labels and descriptions
// Note: high_value_features removed - strategic features belong to Roadmap
// low_hanging_fruit renamed to code_improvements to cover all code-revealed opportunities
export const IDEATION_TYPE_LABELS: Record<string, string> = {
  code_improvements: 'Code Improvements',
  ui_ux_improvements: 'UI/UX Improvements',
  documentation_gaps: 'Documentation',
  security_hardening: 'Security',
  performance_optimizations: 'Performance',
  code_quality: 'Code Quality'
};

export const IDEATION_TYPE_DESCRIPTIONS: Record<string, string> = {
  code_improvements: 'Code-revealed opportunities from patterns, architecture, and infrastructure analysis',
  ui_ux_improvements: 'Visual and interaction improvements identified through app analysis',
  documentation_gaps: 'Missing or outdated documentation that needs attention',
  security_hardening: 'Security vulnerabilities and hardening opportunities',
  performance_optimizations: 'Performance bottlenecks and optimization opportunities',
  code_quality: 'Refactoring opportunities, large files, code smells, and best practice violations'
};

/**
 * Get translated ideation type labels
 * @param t - i18n translation function
 * @returns Record of type keys to translated labels
 */
export const getIdeationTypeLabels = (t: TranslationFunction): Record<string, string> => ({
  code_improvements: t('ideation:types.code_improvements'),
  ui_ux_improvements: t('ideation:types.ui_ux_improvements'),
  documentation_gaps: t('ideation:types.documentation_gaps'),
  security_hardening: t('ideation:types.security_hardening'),
  performance_optimizations: t('ideation:types.performance_optimizations'),
  code_quality: t('ideation:types.code_quality')
});

/**
 * Get translated ideation type descriptions
 * @param t - i18n translation function
 * @returns Record of type keys to translated descriptions
 */
export const getIdeationTypeDescriptions = (t: TranslationFunction): Record<string, string> => ({
  code_improvements: t('ideation:typeDescriptions.code_improvements'),
  ui_ux_improvements: t('ideation:typeDescriptions.ui_ux_improvements'),
  documentation_gaps: t('ideation:typeDescriptions.documentation_gaps'),
  security_hardening: t('ideation:typeDescriptions.security_hardening'),
  performance_optimizations: t('ideation:typeDescriptions.performance_optimizations'),
  code_quality: t('ideation:typeDescriptions.code_quality')
});

// Ideation type colors
export const IDEATION_TYPE_COLORS: Record<string, string> = {
  code_improvements: 'bg-success/10 text-success border-success/30',
  ui_ux_improvements: 'bg-info/10 text-info border-info/30',
  documentation_gaps: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  security_hardening: 'bg-destructive/10 text-destructive border-destructive/30',
  performance_optimizations: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  code_quality: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
};

// Ideation type icons (Lucide icon names)
export const IDEATION_TYPE_ICONS: Record<string, string> = {
  code_improvements: 'Zap',
  ui_ux_improvements: 'Palette',
  documentation_gaps: 'BookOpen',
  security_hardening: 'Shield',
  performance_optimizations: 'Gauge',
  code_quality: 'Code2'
};

// ============================================
// Ideation Status
// ============================================

export const IDEATION_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  selected: 'bg-primary/10 text-primary',
  converted: 'bg-success/10 text-success',
  dismissed: 'bg-destructive/10 text-destructive line-through',
  archived: 'bg-violet-500/10 text-violet-400'
};

// ============================================
// Ideation Effort/Complexity
// ============================================

// Ideation effort colors (full spectrum for code_improvements)
export const IDEATION_EFFORT_COLORS: Record<string, string> = {
  trivial: 'bg-success/10 text-success',
  small: 'bg-info/10 text-info',
  medium: 'bg-warning/10 text-warning',
  large: 'bg-orange-500/10 text-orange-400',
  complex: 'bg-destructive/10 text-destructive'
};

// ============================================
// Ideation Impact
// ============================================

export const IDEATION_IMPACT_COLORS: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-info/10 text-info',
  high: 'bg-warning/10 text-warning',
  critical: 'bg-destructive/10 text-destructive'
};

// ============================================
// Category-Specific Labels
// ============================================

// Security severity colors
export const SECURITY_SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-info/10 text-info',
  medium: 'bg-warning/10 text-warning',
  high: 'bg-orange-500/10 text-orange-500',
  critical: 'bg-destructive/10 text-destructive'
};

// UI/UX category labels
export const UIUX_CATEGORY_LABELS: Record<string, string> = {
  usability: 'Usability',
  accessibility: 'Accessibility',
  performance: 'Performance',
  visual: 'Visual Design',
  interaction: 'Interaction'
};

// Documentation category labels
export const DOCUMENTATION_CATEGORY_LABELS: Record<string, string> = {
  readme: 'README',
  api_docs: 'API Documentation',
  inline_comments: 'Inline Comments',
  examples: 'Examples & Tutorials',
  architecture: 'Architecture Docs',
  troubleshooting: 'Troubleshooting Guide'
};

// Security category labels
export const SECURITY_CATEGORY_LABELS: Record<string, string> = {
  authentication: 'Authentication',
  authorization: 'Authorization',
  input_validation: 'Input Validation',
  data_protection: 'Data Protection',
  dependencies: 'Dependencies',
  configuration: 'Configuration',
  secrets_management: 'Secrets Management'
};

// Performance category labels
export const PERFORMANCE_CATEGORY_LABELS: Record<string, string> = {
  bundle_size: 'Bundle Size',
  runtime: 'Runtime Performance',
  memory: 'Memory Usage',
  database: 'Database Queries',
  network: 'Network Requests',
  rendering: 'Rendering',
  caching: 'Caching'
};

// Code quality category labels
export const CODE_QUALITY_CATEGORY_LABELS: Record<string, string> = {
  large_files: 'Large Files',
  code_smells: 'Code Smells',
  complexity: 'High Complexity',
  duplication: 'Code Duplication',
  naming: 'Naming Conventions',
  structure: 'File Structure',
  linting: 'Linting Issues',
  testing: 'Test Coverage',
  types: 'Type Safety',
  dependencies: 'Dependency Issues',
  dead_code: 'Dead Code',
  git_hygiene: 'Git Hygiene'
};

// Code quality severity colors
export const CODE_QUALITY_SEVERITY_COLORS: Record<string, string> = {
  suggestion: 'bg-info/10 text-info',
  minor: 'bg-warning/10 text-warning',
  major: 'bg-orange-500/10 text-orange-500',
  critical: 'bg-destructive/10 text-destructive'
};

// ============================================
// Default Configuration
// ============================================

// Default ideation config
// Note: high_value_features removed, low_hanging_fruit renamed to code_improvements
export const DEFAULT_IDEATION_CONFIG = {
  enabledTypes: ['code_improvements', 'ui_ux_improvements', 'security_hardening'] as const,
  includeRoadmapContext: true,
  includeKanbanContext: true,
  maxIdeasPerType: 5
};
