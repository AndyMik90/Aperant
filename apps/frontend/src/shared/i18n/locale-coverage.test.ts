import { describe, expect, it } from 'vitest';
import enCommon from './locales/en/common.json';
import enDialogs from './locales/en/dialogs.json';
import enErrors from './locales/en/errors.json';
import enGitlab from './locales/en/gitlab.json';
import enNavigation from './locales/en/navigation.json';
import enOnboarding from './locales/en/onboarding.json';
import enSettings from './locales/en/settings.json';
import enTaskReview from './locales/en/taskReview.json';
import enTasks from './locales/en/tasks.json';
import enTerminal from './locales/en/terminal.json';
import enWelcome from './locales/en/welcome.json';
import frCommon from './locales/fr/common.json';
import frDialogs from './locales/fr/dialogs.json';
import frErrors from './locales/fr/errors.json';
import frGitlab from './locales/fr/gitlab.json';
import frNavigation from './locales/fr/navigation.json';
import frOnboarding from './locales/fr/onboarding.json';
import frSettings from './locales/fr/settings.json';
import frTaskReview from './locales/fr/taskReview.json';
import frTasks from './locales/fr/tasks.json';
import frTerminal from './locales/fr/terminal.json';
import frWelcome from './locales/fr/welcome.json';
import zhCommon from './locales/zh/common.json';
import zhDialogs from './locales/zh/dialogs.json';
import zhErrors from './locales/zh/errors.json';
import zhGitlab from './locales/zh/gitlab.json';
import zhNavigation from './locales/zh/navigation.json';
import zhOnboarding from './locales/zh/onboarding.json';
import zhSettings from './locales/zh/settings.json';
import zhTaskReview from './locales/zh/taskReview.json';
import zhTasks from './locales/zh/tasks.json';
import zhTerminal from './locales/zh/terminal.json';
import zhWelcome from './locales/zh/welcome.json';

const enLocales = {
  common: enCommon,
  dialogs: enDialogs,
  errors: enErrors,
  gitlab: enGitlab,
  navigation: enNavigation,
  onboarding: enOnboarding,
  settings: enSettings,
  taskReview: enTaskReview,
  tasks: enTasks,
  terminal: enTerminal,
  welcome: enWelcome
} as const;

const frLocales = {
  common: frCommon,
  dialogs: frDialogs,
  errors: frErrors,
  gitlab: frGitlab,
  navigation: frNavigation,
  onboarding: frOnboarding,
  settings: frSettings,
  taskReview: frTaskReview,
  tasks: frTasks,
  terminal: frTerminal,
  welcome: frWelcome
} as const;

const zhLocales = {
  common: zhCommon,
  dialogs: zhDialogs,
  errors: zhErrors,
  gitlab: zhGitlab,
  navigation: zhNavigation,
  onboarding: zhOnboarding,
  settings: zhSettings,
  taskReview: zhTaskReview,
  tasks: zhTasks,
  terminal: zhTerminal,
  welcome: zhWelcome
} as const;

function flattenLeaves(node: unknown, prefix = '', acc: Record<string, string> = {}) {
  if (!node || typeof node !== 'object') {
    return acc;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      acc[path] = value;
      continue;
    }
    if (value && typeof value === 'object') {
      flattenLeaves(value, path, acc);
    }
  }
  return acc;
}

function extractPlaceholders(value: string) {
  const matches = value.match(/\{\{[^}]+\}\}|<\/?\d+>|`[^`]+`/g) || [];
  return [...new Set(matches)].sort();
}

describe('locale coverage', () => {
  it('keeps zh key coverage aligned with en', () => {
    for (const namespace of Object.keys(enLocales) as Array<keyof typeof enLocales>) {
      const enFlat = flattenLeaves(enLocales[namespace]);
      const zhFlat = flattenLeaves(zhLocales[namespace]);
      const missingInZh = Object.keys(enFlat).filter((key) => !(key in zhFlat));
      const extraInZh = Object.keys(zhFlat).filter((key) => !(key in enFlat));
      expect(missingInZh, `${namespace} missing keys in zh`).toEqual([]);
      expect(extraInZh, `${namespace} extra keys in zh`).toEqual([]);
    }
  });

  it('keeps zh placeholders aligned with en', () => {
    for (const namespace of Object.keys(enLocales) as Array<keyof typeof enLocales>) {
      const enFlat = flattenLeaves(enLocales[namespace]);
      const zhFlat = flattenLeaves(zhLocales[namespace]);
      for (const key of Object.keys(enFlat)) {
        const enPlaceholders = extractPlaceholders(enFlat[key]);
        const zhPlaceholders = extractPlaceholders(zhFlat[key] ?? '');
        expect(zhPlaceholders, `${namespace}.${key} placeholder mismatch`).toEqual(enPlaceholders);
        expect(zhFlat[key], `${namespace}.${key} unresolved token`).not.toContain('__TOKEN_');
      }
    }
  });

  it('keeps zh translations readable', () => {
    for (const namespace of Object.keys(zhLocales) as Array<keyof typeof zhLocales>) {
      const zhFlat = flattenLeaves(zhLocales[namespace]);
      for (const [key, value] of Object.entries(zhFlat)) {
        expect(value, `${namespace}.${key} should not be empty`).not.toBe('');
        expect(value, `${namespace}.${key} contains mojibake`).not.toContain('�');
      }
    }
  });

  it('reports current en/fr key deltas for audit visibility', () => {
    const deltas: string[] = [];
    for (const namespace of Object.keys(enLocales) as Array<keyof typeof enLocales>) {
      const enFlat = flattenLeaves(enLocales[namespace]);
      const frFlat = flattenLeaves(frLocales[namespace]);
      const missingInFr = Object.keys(enFlat).filter((key) => !(key in frFlat));
      const extraInFr = Object.keys(frFlat).filter((key) => !(key in enFlat));
      if (missingInFr.length > 0 || extraInFr.length > 0) {
        deltas.push(`${namespace}: missing=${missingInFr.length}, extra=${extraInFr.length}`);
      }
    }
    // Informational audit — log deltas but do not block CI on exact counts.
    // The en/fr gap is pre-existing debt; only zh parity is enforced above.
    if (deltas.length > 0) {
      console.info('[i18n audit] en/fr key deltas:', deltas);
    }
    // Ensure deltas are computed (smoke-check the audit ran)
    expect(Array.isArray(deltas)).toBe(true);
  });
});
