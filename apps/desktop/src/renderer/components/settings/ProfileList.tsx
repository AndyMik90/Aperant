/**
 * ProfileList - Display and manage API profiles
 *
 * Shows all configured API profiles with an "Add Profile" button.
 * Displays empty state when no profiles exist.
 * Allows setting active profile, editing, and deleting profiles.
 */
import { useState } from 'react';
import { Plus, Trash2, Check, Server, Globe, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useSettingsStore } from '../../stores/settings-store';
import { ProfileEditDialog } from './ProfileEditDialog';
import { maskApiKey } from '../../lib/profile-utils';
import { cn } from '../../lib/utils';
import { useToast } from '../../hooks/use-toast';
import type { APIProfile } from '@shared/types/profile';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog';

interface ProfileListProps {
  /** Optional callback when a profile is saved */
  onProfileSaved?: () => void;
}

export function ProfileList({ onProfileSaved }: ProfileListProps) {
  const { t } = useTranslation();
  const {
    profiles,
    activeProfileId,
    deleteProfile,
    setActiveProfile,
    profilesError
  } = useSettingsStore();

  const { toast } = useToast();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<APIProfile | null>(null);
  const [deleteConfirmProfile, setDeleteConfirmProfile] = useState<APIProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSettingActive, setIsSettingActive] = useState(false);

  const handleDeleteProfile = async () => {
    if (!deleteConfirmProfile) return;

    setIsDeleting(true);
    const success = await deleteProfile(deleteConfirmProfile.id);
    setIsDeleting(false);

    if (success) {
      toast({
        title: t('settings:apiProfiles.toast.delete.title'),
        description: t('settings:apiProfiles.toast.delete.description', {
          name: deleteConfirmProfile.name
        }),
      });
      setDeleteConfirmProfile(null);
      if (onProfileSaved) {
        onProfileSaved();
      }
    } else {
      // Show error toast - handles both active profile error and other errors
      toast({
        variant: 'destructive',
        title: t('settings:apiProfiles.toast.delete.errorTitle'),
        description: profilesError || t('settings:apiProfiles.toast.delete.errorFallback'),
      });
    }
  };

  /**
   * Handle setting a profile as active or switching to OAuth
   * @param profileId - The profile ID to activate, or null to switch to OAuth
   */
  const handleSetActiveProfile = async (profileId: string | null) => {
    // Allow switching to OAuth (null) even when no profile is active
    if (profileId !== null && profileId === activeProfileId) return;

    setIsSettingActive(true);
    const success = await setActiveProfile(profileId);
    setIsSettingActive(false);

    if (success) {
      // Show success toast
      if (profileId === null) {
        // Switched to OAuth
        toast({
          title: t('settings:apiProfiles.toast.switch.oauthTitle'),
          description: t('settings:apiProfiles.toast.switch.oauthDescription'),
        });
      } else {
        // Switched to profile
        const activeProfile = profiles.find(p => p.id === profileId);
        if (activeProfile) {
          toast({
            title: t('settings:apiProfiles.toast.switch.profileTitle'),
            description: t('settings:apiProfiles.toast.switch.profileDescription', {
              name: activeProfile.name
            }),
          });
        }
      }
      if (onProfileSaved) {
        onProfileSaved();
      }
    } else {
      // Show error toast on failure
      toast({
        variant: 'destructive',
        title: t('settings:apiProfiles.toast.switch.errorTitle'),
        description: profilesError || t('settings:apiProfiles.toast.switch.errorFallback'),
      });
    }
  };

  const getHostFromUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.host;
    } catch {
      return url;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('settings:apiProfiles.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('settings:apiProfiles.description')}
          </p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
          <Plus className="h-4 w-4 me-2" />
          {t('settings:apiProfiles.addButton')}
        </Button>
      </div>

      {/* Empty state */}
      {profiles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 border border-dashed rounded-lg">
          <Server className="h-12 w-12 text-muted-foreground mb-4" />
          <h4 className="text-lg font-medium mb-2">{t('settings:apiProfiles.empty.title')}</h4>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
            {t('settings:apiProfiles.empty.description')}
          </p>
          <Button onClick={() => setIsAddDialogOpen(true)} variant="outline">
            <Plus className="h-4 w-4 me-2" />
            {t('settings:apiProfiles.empty.action')}
          </Button>
        </div>
      )}

      {/* Profile list */}
      {profiles.length > 0 && (
        <div className="space-y-2">
          {/* Switch to OAuth button (visible when a profile is active) */}
          {activeProfileId && (
            <div className="flex items-center justify-end pb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSetActiveProfile(null)}
                disabled={isSettingActive}
              >
                {isSettingActive
                  ? t('settings:apiProfiles.switchToOauth.loading')
                  : t('settings:apiProfiles.switchToOauth.label')}
              </Button>
            </div>
          )}
          {profiles.map((profile) => {
            const isActive = activeProfileId === profile.id;
            return (
              <div
                key={profile.id}
                className={cn(
                  'flex items-center justify-between p-4 rounded-lg border transition-colors',
                  isActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent/50'
                )}
              >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium truncate">{profile.name}</h4>
                  {activeProfileId === profile.id && (
                    <span className="flex items-center text-xs text-primary">
                      <Check className="h-3 w-3 me-1" />
                      {t('settings:apiProfiles.activeBadge')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        <span className="truncate max-w-[200px]">
                          {getHostFromUrl(profile.baseUrl)}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{profile.baseUrl}</p>
                    </TooltipContent>
                  </Tooltip>
                  <div className="truncate">
                    {maskApiKey(profile.apiKey)}
                  </div>
                </div>
                {profile.models && Object.keys(profile.models).length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('settings:apiProfiles.customModels', {
                      models: Object.keys(profile.models).join(', ')
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {activeProfileId !== profile.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSetActiveProfile(profile.id)}
                    disabled={isSettingActive}
                  >
                    {isSettingActive
                      ? t('settings:apiProfiles.setActive.loading')
                      : t('settings:apiProfiles.setActive.label')}
                  </Button>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditProfile(profile)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('settings:apiProfiles.tooltips.edit')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirmProfile(profile)}
                      disabled={isActive}
                      className="text-destructive hover:text-destructive"
                      data-testid={`profile-delete-button-${profile.id}`}
                      aria-label={t('settings:apiProfiles.deleteAriaLabel', {
                        name: profile.name
                      })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isActive
                      ? t('settings:apiProfiles.tooltips.deleteActive')
                      : t('settings:apiProfiles.tooltips.deleteInactive')}
                  </TooltipContent>
                </Tooltip>
              </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <ProfileEditDialog
        open={isAddDialogOpen || editProfile !== null}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddDialogOpen(false);
            setEditProfile(null);
          }
        }}
        onSaved={() => {
          setIsAddDialogOpen(false);
          setEditProfile(null);
          onProfileSaved?.();
        }}
        profile={editProfile ?? undefined}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirmProfile !== null}
        onOpenChange={() => setDeleteConfirmProfile(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings:apiProfiles.dialog.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings:apiProfiles.dialog.deleteDescription', {
                name: deleteConfirmProfile?.name ?? ''
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t('settings:apiProfiles.dialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProfile}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting
                ? t('settings:apiProfiles.dialog.deleting')
                : t('settings:apiProfiles.dialog.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
