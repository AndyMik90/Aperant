import { Github, Wrench, GitMerge, GitlabIcon, GitPullRequest, LayoutGrid, Terminal, Sparkles, Lightbulb, FileText, BookOpen, GitBranch, Map } from "lucide-react";

export type SidebarView = 'kanban' | 'terminals' | 'roadmap' | 'context' | 'ideation' | 'github-issues' | 'gitlab-issues' | 'github-prs' | 'gitlab-merge-requests' | 'changelog' | 'insights' | 'worktrees' | 'agent-tools';

export interface SidebarProps {
  onSettingsClick: () => void;
  onNewTaskClick: () => void;
  activeView?: SidebarView;
  onViewChange?: (view: SidebarView) => void;
}

export interface NavItem {
  id: SidebarView;
  labelKey: string;
  icon: React.ElementType;
  shortcut?: string;
}

// Base nav items always shown
export const baseNavItems: NavItem[] = [
    { id: 'kanban', labelKey: 'navigation:items.kanban', icon: LayoutGrid, shortcut: 'K' },
    { id: 'terminals', labelKey: 'navigation:items.terminals', icon: Terminal, shortcut: 'A' },
    { id: 'insights', labelKey: 'navigation:items.insights', icon: Sparkles, shortcut: 'N' },
    { id: 'roadmap', labelKey: 'navigation:items.roadmap', icon: Map, shortcut: 'D' },
    { id: 'ideation', labelKey: 'navigation:items.ideation', icon: Lightbulb, shortcut: 'I' },
    { id: 'changelog', labelKey: 'navigation:items.changelog', icon: FileText, shortcut: 'L' },
    { id: 'context', labelKey: 'navigation:items.context', icon: BookOpen, shortcut: 'C' },
    { id: 'agent-tools', labelKey: 'navigation:items.agentTools', icon: Wrench, shortcut: 'M' },
    { id: 'worktrees', labelKey: 'navigation:items.worktrees', icon: GitBranch, shortcut: 'W' }
  ];

  // GitHub nav items shown when GitHub is enabled
  export const githubNavItems: NavItem[] = [
    { id: 'github-issues', labelKey: 'navigation:items.githubIssues', icon: Github, shortcut: 'G' },
    { id: 'github-prs', labelKey: 'navigation:items.githubPRs', icon: GitPullRequest, shortcut: 'P' }
  ];

  // GitLab nav items shown when GitLab is enabled
  export const gitlabNavItems: NavItem[] = [
    { id: 'gitlab-issues', labelKey: 'navigation:items.gitlabIssues', icon: GitlabIcon, shortcut: 'B' },
    { id: 'gitlab-merge-requests', labelKey: 'navigation:items.gitlabMRs', icon: GitMerge, shortcut: 'R' }
  ];
