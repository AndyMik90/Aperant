import { RefreshCw, AlertCircle, FolderTree, RotateCcw, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { ServiceCard } from './ServiceCard';
import { InfoItem } from './InfoItem';
import type { ProjectIndex } from '../../../shared/types';

interface ProjectIndexTabProps {
  projectIndex: ProjectIndex | null;
  indexLoading: boolean;
  indexError: string | null;
  indexProgress: string | null;
  indexProgressCurrent: number | null;
  indexProgressTotal: number | null;
  onRefresh: (force?: boolean) => void;
}

export function ProjectIndexTab({
  projectIndex,
  indexLoading,
  indexError,
  indexProgress,
  indexProgressCurrent,
  indexProgressTotal,
  onRefresh
}: ProjectIndexTabProps) {
  const { t } = useTranslation('context');
  const isCustomer = projectIndex?.project_type === 'customer';
  const childRepoCount = projectIndex?.child_repos ? Object.keys(projectIndex.child_repos).length : 0;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header with refresh / re-analyze buttons */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('projectIndex.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('projectIndex.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Re-analyze button (forces re-run of analyzer on all repos) */}
            {projectIndex && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRefresh(true)}
                    disabled={indexLoading}
                  >
                    <RotateCcw className={cn('h-4 w-4 mr-2', indexLoading && 'animate-spin')} />
                    {t('projectIndex.reanalyze')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('projectIndex.reanalyzeTooltip')}</TooltipContent>
              </Tooltip>
            )}
            {/* Refresh button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRefresh(false)}
                  disabled={indexLoading}
                >
                  <RefreshCw className={cn('h-4 w-4 mr-2', indexLoading && 'animate-spin')} />
                  {t('projectIndex.refresh')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('projectIndex.analyzeTooltip')}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Error state */}
        {indexError && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">{t('projectIndex.errorTitle')}</p>
              <p className="text-sm opacity-80">{indexError}</p>
            </div>
          </div>
        )}

        {/* Loading state with progress */}
        {indexLoading && !projectIndex && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            {indexProgress ? (
              <div className="text-center space-y-2">
                <p className="text-sm font-medium text-foreground">{indexProgress}</p>
                {indexProgressTotal != null && indexProgressCurrent != null ? (
                  <div className="w-64 mx-auto">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{t('projectIndex.repoProgress', { current: indexProgressCurrent, total: indexProgressTotal })}</span>
                      <span>{indexProgressTotal > 0 ? Math.round((indexProgressCurrent / indexProgressTotal) * 100) : 0}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${indexProgressTotal > 0 ? (indexProgressCurrent / indexProgressTotal) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('projectIndex.analyzing')}</p>
            )}
          </div>
        )}

        {/* Inline progress when refreshing existing data */}
        {indexLoading && projectIndex && indexProgress && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20">
            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{indexProgress}</p>
              {indexProgressTotal != null && indexProgressCurrent != null ? (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>{t('projectIndex.repoProgress', { current: indexProgressCurrent, total: indexProgressTotal })}</span>
                    <span>{indexProgressTotal > 0 ? Math.round((indexProgressCurrent / indexProgressTotal) * 100) : 0}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${indexProgressTotal > 0 ? (indexProgressCurrent / indexProgressTotal) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* No index state */}
        {!indexLoading && !projectIndex && !indexError && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderTree className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground">{t('projectIndex.noIndexTitle')}</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              {t('projectIndex.noIndexDescription')}
            </p>
            <Button onClick={() => onRefresh(false)} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('projectIndex.analyzeButton')}
            </Button>
          </div>
        )}

        {/* Project index content */}
        {projectIndex && (
          <div className="space-y-6">
            {/* Project Overview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('projectIndex.overview')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {projectIndex.project_type}
                  </Badge>
                  {Object.keys(projectIndex.services).length > 0 && (
                    <Badge variant="secondary">
                      {t('projectIndex.serviceCount', { count: Object.keys(projectIndex.services).length })}
                    </Badge>
                  )}
                  {isCustomer && childRepoCount > 0 && (
                    <Badge variant="secondary">
                      {t('projectIndex.repoCount', { count: childRepoCount })}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground font-mono truncate">
                  {projectIndex.project_root}
                </p>
              </CardContent>
            </Card>

            {/* Child Repos (customer only) */}
            {isCustomer && projectIndex.child_repos && Object.keys(projectIndex.child_repos).length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('projectIndex.repositories')}
                </h3>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(projectIndex.child_repos).map(([repoName, repoIndex]) => {
                    const serviceCount = Object.keys(repoIndex.services).length;
                    const mainService = Object.values(repoIndex.services)[0];
                    return (
                      <Card key={repoName} className="border-muted">
                        <CardContent className="pt-4 pb-3 px-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{repoName}</p>
                              {mainService && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {mainService.language}
                                  {mainService.framework ? ` / ${mainService.framework}` : ''}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {mainService?.type && (
                                <Badge variant="outline" className="text-[10px] capitalize px-1.5">
                                  {mainService.type}
                                </Badge>
                              )}
                              {serviceCount > 1 && (
                                <Badge variant="secondary" className="text-[10px] px-1.5">
                                  {t('projectIndex.svcCount', { count: serviceCount })}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Services */}
            {Object.keys(projectIndex.services).length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('projectIndex.services')}
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  {Object.entries(projectIndex.services).map(([name, service]) => (
                    <ServiceCard key={name} name={name} service={service} />
                  ))}
                </div>
              </div>
            )}

            {/* Infrastructure */}
            {Object.keys(projectIndex.infrastructure).length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('projectIndex.infrastructure')}
                </h3>
                <Card>
                  <CardContent className="pt-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {projectIndex.infrastructure.docker_compose && (
                        <InfoItem label={t('projectIndex.dockerCompose')} value={projectIndex.infrastructure.docker_compose} />
                      )}
                      {projectIndex.infrastructure.ci && (
                        <InfoItem label={t('projectIndex.ciCd')} value={projectIndex.infrastructure.ci} />
                      )}
                      {projectIndex.infrastructure.deployment && (
                        <InfoItem label={t('projectIndex.deployment')} value={projectIndex.infrastructure.deployment} />
                      )}
                      {projectIndex.infrastructure.docker_services &&
                        projectIndex.infrastructure.docker_services.length > 0 && (
                          <div className="sm:col-span-2">
                            <span className="text-xs text-muted-foreground">{t('projectIndex.dockerServices')}</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {projectIndex.infrastructure.docker_services.map((svc) => (
                                <Badge key={svc} variant="secondary" className="text-xs">
                                  {svc}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Conventions */}
            {Object.keys(projectIndex.conventions).length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('projectIndex.conventions')}
                </h3>
                <Card>
                  <CardContent className="pt-6">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {projectIndex.conventions.python_linting && (
                        <InfoItem label={t('projectIndex.pythonLinting')} value={projectIndex.conventions.python_linting} />
                      )}
                      {projectIndex.conventions.js_linting && (
                        <InfoItem label={t('projectIndex.jsLinting')} value={projectIndex.conventions.js_linting} />
                      )}
                      {projectIndex.conventions.formatting && (
                        <InfoItem label={t('projectIndex.formatting')} value={projectIndex.conventions.formatting} />
                      )}
                      {projectIndex.conventions.git_hooks && (
                        <InfoItem label={t('projectIndex.gitHooks')} value={projectIndex.conventions.git_hooks} />
                      )}
                      {projectIndex.conventions.typescript && (
                        <InfoItem label={t('projectIndex.typescript')} value={t('projectIndex.enabled')} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
