import { AVAILABLE_LANGUAGES } from '../../../shared/constants/i18n';

export function buildLanguageInstruction(language: string): string | null {
  if (!language || language === 'en') return null;
  const entry = AVAILABLE_LANGUAGES.find((l) => l.value === language);
  const langName = entry?.label ?? language;
  return (
    `**LANGUAGE**: Always respond in ${langName}. All code comments, ` +
    `documentation, commit messages, and explanations must be in ${langName}.\n\n`
  );
}
