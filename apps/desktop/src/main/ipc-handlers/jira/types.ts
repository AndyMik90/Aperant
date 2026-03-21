/**
 * JIRA module types and interfaces
 */

export interface JiraConfig {
  host: string; // e.g., https://company.atlassian.net
  email: string; // JIRA user email
  token: string; // API token
  projectKey?: string; // Default project key
}

export interface JiraIssue {
  key: string;
  summary: string;
  description?: string;
  status: string;
  assignee?: string;
  priority?: string;
  issueType: string;
  created: string;
  updated: string;
  labels: string[];
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

export interface JiraProject {
  key: string;
  name: string;
  id: string;
}

/**
 * JIRA REST API response types (raw API shapes)
 */

export interface JiraAPIUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
  active: boolean;
}

export interface JiraAPIIssueFields {
  summary: string;
  description?: string;
  status: { name: string; id: string };
  assignee?: JiraAPIUser;
  priority?: { name: string; id: string };
  issuetype: { name: string; id: string };
  created: string;
  updated: string;
  labels: string[];
  project: { key: string; name: string; id: string };
}

export interface JiraAPIIssue {
  id: string;
  key: string;
  fields: JiraAPIIssueFields;
}

export interface JiraAPISearchResponse {
  issues: JiraAPIIssue[];
  total: number;
  maxResults: number;
  startAt: number;
}

export interface JiraAPIProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
}

export interface JiraAPITransition {
  id: string;
  name: string;
  to: { name: string; id: string };
}
