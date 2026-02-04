import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import English translation resources
import enCommon from './locales/en/common.json';
import enNavigation from './locales/en/navigation.json';
import enSettings from './locales/en/settings.json';
import enTasks from './locales/en/tasks.json';
import enWelcome from './locales/en/welcome.json';
import enOnboarding from './locales/en/onboarding.json';
import enDialogs from './locales/en/dialogs.json';
import enGitlab from './locales/en/gitlab.json';
import enTaskReview from './locales/en/taskReview.json';
import enTerminal from './locales/en/terminal.json';
import enErrors from './locales/en/errors.json';

// Import French translation resources
import frCommon from './locales/fr/common.json';
import frNavigation from './locales/fr/navigation.json';
import frSettings from './locales/fr/settings.json';
import frTasks from './locales/fr/tasks.json';
import frWelcome from './locales/fr/welcome.json';
import frOnboarding from './locales/fr/onboarding.json';
import frDialogs from './locales/fr/dialogs.json';
import frGitlab from './locales/fr/gitlab.json';
import frTaskReview from './locales/fr/taskReview.json';
import frTerminal from './locales/fr/terminal.json';
import frErrors from './locales/fr/errors.json';

// Import Traditional Chinese translation resources
import zhTWCommon from './locales/zh-TW/common.json';
import zhTWNavigation from './locales/zh-TW/navigation.json';
import zhTWSettings from './locales/zh-TW/settings.json';
import zhTWTasks from './locales/zh-TW/tasks.json';
import zhTWWelcome from './locales/zh-TW/welcome.json';
import zhTWOnboarding from './locales/zh-TW/onboarding.json';
import zhTWDialogs from './locales/zh-TW/dialogs.json';
import zhTWGitlab from './locales/zh-TW/gitlab.json';
import zhTWTaskReview from './locales/zh-TW/taskReview.json';
import zhTWTerminal from './locales/zh-TW/terminal.json';
import zhTWErrors from './locales/zh-TW/errors.json';

export const defaultNS = 'common';

export const resources = {
  en: {
    common: enCommon,
    navigation: enNavigation,
    settings: enSettings,
    tasks: enTasks,
    welcome: enWelcome,
    onboarding: enOnboarding,
    dialogs: enDialogs,
    gitlab: enGitlab,
    taskReview: enTaskReview,
    terminal: enTerminal,
    errors: enErrors
  },
  fr: {
    common: frCommon,
    navigation: frNavigation,
    settings: frSettings,
    tasks: frTasks,
    welcome: frWelcome,
    onboarding: frOnboarding,
    dialogs: frDialogs,
    gitlab: frGitlab,
    taskReview: frTaskReview,
    terminal: frTerminal,
    errors: frErrors
  },
  'zh-TW': {
    common: zhTWCommon,
    navigation: zhTWNavigation,
    settings: zhTWSettings,
    tasks: zhTWTasks,
    welcome: zhTWWelcome,
    onboarding: zhTWOnboarding,
    dialogs: zhTWDialogs,
    gitlab: zhTWGitlab,
    taskReview: zhTWTaskReview,
    terminal: zhTWTerminal,
    errors: zhTWErrors
  }
} as const;

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en', // Default language (will be overridden by settings)
    fallbackLng: 'en',
    defaultNS,
    ns: ['common', 'navigation', 'settings', 'tasks', 'welcome', 'onboarding', 'dialogs', 'gitlab', 'taskReview', 'terminal', 'errors'],
    interpolation: {
      escapeValue: false // React already escapes values
    },
    react: {
      useSuspense: false // Disable suspense for Electron compatibility
    }
  });

export default i18n;
