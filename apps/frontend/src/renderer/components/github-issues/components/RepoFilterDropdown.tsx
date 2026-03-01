import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../ui/select';

interface RepoFilterDropdownProps {
  repos: string[];
  selectedRepo: string;
  onRepoChange: (repo: string) => void;
}

export function RepoFilterDropdown({ repos, selectedRepo, onRepoChange }: RepoFilterDropdownProps) {
  const { t } = useTranslation('navigation');

  if (repos.length === 0) return null;

  return (
    <Select value={selectedRepo} onValueChange={onRepoChange}>
      <SelectTrigger className="w-48">
        <GitBranch className="h-4 w-4 mr-2" />
        <SelectValue placeholder={t('multiRepo.filterByRepo')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          {t('multiRepo.allRepos')}
        </SelectItem>
        {repos.map((repo) => (
          <SelectItem key={repo} value={repo}>
            {repo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
