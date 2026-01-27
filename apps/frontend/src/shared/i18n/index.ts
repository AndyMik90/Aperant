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
import enAgentTools from './locales/en/agentTools.json';
import enChangelog from './locales/en/changelog.json';
import enContext from './locales/en/context.json';
import enIdeation from './locales/en/ideation.json';
import enInsights from './locales/en/insights.json';
import enLinear from './locales/en/linear.json';
import enRoadmap from './locales/en/roadmap.json';
import enWorkspace from './locales/en/workspace.json';
import enGithub from './locales/en/github.json';

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
import frAgentTools from './locales/fr/agentTools.json';
import frChangelog from './locales/fr/changelog.json';
import frContext from './locales/fr/context.json';
import frIdeation from './locales/fr/ideation.json';
import frInsights from './locales/fr/insights.json';
import frLinear from './locales/fr/linear.json';
import frRoadmap from './locales/fr/roadmap.json';
import frWorkspace from './locales/fr/workspace.json';
import frGithub from './locales/fr/github.json';

// Import Chinese translation resources
import zhCommon from './locales/zh-CN/common.json';
import zhNavigation from './locales/zh-CN/navigation.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhTasks from './locales/zh-CN/tasks.json';
import zhWelcome from './locales/zh-CN/welcome.json';
import zhOnboarding from './locales/zh-CN/onboarding.json';
import zhDialogs from './locales/zh-CN/dialogs.json';
import zhGitlab from './locales/zh-CN/gitlab.json';
import zhTaskReview from './locales/zh-CN/taskReview.json';
import zhTerminal from './locales/zh-CN/terminal.json';
import zhErrors from './locales/zh-CN/errors.json';
import zhAgentTools from './locales/zh-CN/agentTools.json';
import zhChangelog from './locales/zh-CN/changelog.json';
import zhContext from './locales/zh-CN/context.json';
import zhIdeation from './locales/zh-CN/ideation.json';
import zhInsights from './locales/zh-CN/insights.json';
import zhLinear from './locales/zh-CN/linear.json';
import zhRoadmap from './locales/zh-CN/roadmap.json';
import zhWorkspace from './locales/zh-CN/workspace.json';
import zhGithub from './locales/zh-CN/github.json';

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
    errors: enErrors,
    agentTools: enAgentTools,
    changelog: enChangelog,
    context: enContext,
    ideation: enIdeation,
    insights: enInsights,
    linear: enLinear,
    roadmap: enRoadmap,
    workspace: enWorkspace,
    github: enGithub
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
    errors: frErrors,
    agentTools: frAgentTools,
    changelog: frChangelog,
    context: frContext,
    ideation: frIdeation,
    insights: frInsights,
    linear: frLinear,
    roadmap: frRoadmap,
    workspace: frWorkspace,
    github: frGithub
  },
  'zh-CN': {
    common: zhCommon,
    navigation: zhNavigation,
    settings: zhSettings,
    tasks: zhTasks,
    welcome: zhWelcome,
    onboarding: zhOnboarding,
    dialogs: zhDialogs,
    gitlab: zhGitlab,
    taskReview: zhTaskReview,
    terminal: zhTerminal,
    errors: zhErrors,
    agentTools: zhAgentTools,
    changelog: zhChangelog,
    context: zhContext,
    ideation: zhIdeation,
    insights: zhInsights,
    linear: zhLinear,
    roadmap: zhRoadmap,
    workspace: zhWorkspace,
    github: zhGithub
  }
} as const;

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en', // Default language (will be overridden by settings)
    fallbackLng: 'en',
    defaultNS,
    ns: ['common', 'navigation', 'settings', 'tasks', 'welcome', 'onboarding', 'dialogs', 'gitlab', 'taskReview', 'terminal', 'errors', 'agentTools', 'changelog', 'context', 'ideation', 'insights', 'linear', 'roadmap', 'workspace', 'github'],
    interpolation: {
      escapeValue: false // React already escapes values
    },
    react: {
      useSuspense: false // Disable suspense for Electron compatibility
    }
  });

export default i18n;
