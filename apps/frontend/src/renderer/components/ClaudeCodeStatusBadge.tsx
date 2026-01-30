import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Terminal,
  Check,
  AlertTriangle,
  X,
  Loader2,
  Download,
  RefreshCw,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { cn } from "../lib/utils";
import type { ClaudeCodeVersionInfo, ClaudeInstallationInfo } from "../../shared/types/cli";

interface ClaudeCodeStatusBadgeProps {
  className?: string;
}

type StatusType = "loading" | "installed" | "outdated" | "not-found" | "error";

// Check every 24 hours
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Delay before re-checking version after install/update
const VERSION_RECHECK_DELAY_MS = 5000;

/**
 * Claude Code CLI status badge for the sidebar.
 * Shows installation status and provides quick access to install/update.
 */
export function ClaudeCodeStatusBadge({ className }: ClaudeCodeStatusBadgeProps) {
  const { t } = useTranslation(["common", "navigation"]);
  const [status, setStatus] = useState<StatusType>("loading");
  const [versionInfo, setVersionInfo] = useState<ClaudeCodeVersionInfo | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showUpdateWarning, setShowUpdateWarning] = useState(false);

  // Version rollback state
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [showRollbackWarning, setShowRollbackWarning] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // CLI path selection state
  const [installations, setInstallations] = useState<ClaudeInstallationInfo[]>([]);
  const [isLoadingInstallations, setIsLoadingInstallations] = useState(false);
  const [installationsError, setInstallationsError] = useState<string | null>(null);
  const [selectedInstallation, setSelectedInstallation] = useState<string | null>(null);
  const [showPathChangeWarning, setShowPathChangeWarning] = useState(false);

  // Check Claude Code version
  const checkVersion = useCallback(async () => {
    try {
      if (!window.electronAPI?.checkClaudeCodeVersion) {
        setStatus("error");
        return;
      }

      const result = await window.electronAPI.checkClaudeCodeVersion();

      if (result.success && result.data) {
        setVersionInfo(result.data);
        setLastChecked(new Date());

        if (!result.data.installed) {
          setStatus("not-found");
        } else if (result.data.isOutdated) {
          setStatus("outdated");
        } else {
          setStatus("installed");
        }
      } else {
        setStatus("error");
      }
    } catch (err) {
      console.error("Failed to check Claude Code version:", err);
      setStatus("error");
    }
  }, []);

  // Fetch available versions
  const fetchVersions = useCallback(async () => {
    if (!window.electronAPI?.getClaudeCodeVersions) {
      return;
    }

    setIsLoadingVersions(true);
    setVersionsError(null);

    try {
      const result = await window.electronAPI.getClaudeCodeVersions();
      if (result.success && result.data) {
        setAvailableVersions(result.data.versions);
      } else {
        setVersionsError(result.error || "Failed to load versions");
      }
    } catch (err) {
      console.error("Failed to fetch versions:", err);
      setVersionsError("Failed to load versions");
    } finally {
      setIsLoadingVersions(false);
    }
  }, []);

  // Fetch CLI installations
  const fetchInstallations = useCallback(async () => {
    if (!window.electronAPI?.getClaudeCodeInstallations) {
      return;
    }

    setIsLoadingInstallations(true);
    setInstallationsError(null);

    try {
      const result = await window.electronAPI.getClaudeCodeInstallations();
      if (result.success && result.data) {
        setInstallations(result.data.installations);
      } else {
        setInstallationsError(result.error || "Failed to load installations");
      }
    } catch (err) {
      console.error("Failed to fetch installations:", err);
      setInstallationsError("Failed to load installations");
    } finally {
      setIsLoadingInstallations(false);
    }
  }, []);

  // Initial check and periodic re-check
  useEffect(() => {
    checkVersion();

    // Set up periodic check
    const interval = setInterval(() => {
      checkVersion();
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkVersion]);

  // Fetch versions when popover opens and Claude is installed
  useEffect(() => {
    if (isOpen && versionInfo?.installed && availableVersions.length === 0) {
      fetchVersions();
    }
  }, [isOpen, versionInfo?.installed, availableVersions.length, fetchVersions]);

  // Fetch installations when popover opens
  useEffect(() => {
    if (isOpen && installations.length === 0) {
      fetchInstallations();
    }
  }, [isOpen, installations.length, fetchInstallations]);

  // Perform the actual install/update
  const performInstall = async () => {
    setIsInstalling(true);
    setShowUpdateWarning(false);
    setInstallError(null);
    try {
      if (!window.electronAPI?.installClaudeCode) {
        setInstallError("Installation not available");
        setIsInstalling(false);
        return;
      }

      const result = await window.electronAPI.installClaudeCode();

      if (result.success) {
        // Re-check after a delay
        setTimeout(() => {
          checkVersion();
        }, VERSION_RECHECK_DELAY_MS);
      } else {
        setInstallError(result.error || "Installation failed");
      }
    } catch (err) {
      console.error("Failed to install Claude Code:", err);
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    } finally {
      setIsInstalling(false);
    }
  };

  // Perform version rollback/switch
  const performVersionSwitch = async () => {
    if (!selectedVersion) return;

    setIsInstalling(true);
    setShowRollbackWarning(false);
    setInstallError(null);

    try {
      if (!window.electronAPI?.installClaudeCodeVersion) {
        setInstallError("Version switching not available");
        return;
      }

      const result = await window.electronAPI.installClaudeCodeVersion(selectedVersion);

      if (result.success) {
        // Re-check after a delay
        setTimeout(() => {
          checkVersion();
        }, VERSION_RECHECK_DELAY_MS);
      } else {
        setInstallError(result.error || "Failed to switch version");
      }
    } catch (err) {
      console.error("Failed to switch Claude Code version:", err);
      setInstallError(err instanceof Error ? err.message : "Failed to switch version");
    } finally {
      setIsInstalling(false);
      setSelectedVersion(null);
    }
  };

  // Perform CLI path switch
  const performPathSwitch = async () => {
    if (!selectedInstallation) return;

    setIsInstalling(true);
    setShowPathChangeWarning(false);
    setInstallError(null);

    try {
      if (!window.electronAPI?.setClaudeCodeActivePath) {
        setInstallError("Path switching not available");
        return;
      }

      const result = await window.electronAPI.setClaudeCodeActivePath(selectedInstallation);

      if (result.success) {
        // Re-check version and refresh installations
        setTimeout(() => {
          checkVersion();
          fetchInstallations();
        }, VERSION_RECHECK_DELAY_MS);
      } else {
        setInstallError(result.error || "Failed to switch CLI path");
      }
    } catch (err) {
      console.error("Failed to switch Claude CLI path:", err);
      setInstallError(err instanceof Error ? err.message : "Failed to switch CLI path");
    } finally {
      setIsInstalling(false);
      setSelectedInstallation(null);
    }
  };

  // Handle install/update button click
  const handleInstall = () => {
    if (status === "outdated") {
      // Show warning for updates since it will close running Claude sessions
      setShowUpdateWarning(true);
    } else {
      // Fresh install - no warning needed
      performInstall();
    }
  };

  // Handle installation selection
  const handleInstallationSelect = (cliPath: string) => {
    // Don't do anything if it's the currently active installation
    const installation = installations.find(i => i.path === cliPath);
    if (installation?.isActive) {
      return;
    }
    setInstallError(null);
    setSelectedInstallation(cliPath);
    setShowPathChangeWarning(true);
  };

  // Normalize version string by removing 'v' prefix for comparison
  const normalizeVersion = (v: string) => v.replace(/^v/, '');

  // Handle version selection
  const handleVersionSelect = (version: string) => {
    // Don't do anything if it's the currently installed version (normalize both for comparison)
    const normalizedSelected = normalizeVersion(version);
    const normalizedInstalled = versionInfo?.installed ? normalizeVersion(versionInfo.installed) : '';
    if (normalizedSelected === normalizedInstalled) {
      return;
    }
    setInstallError(null);
    setSelectedVersion(version);
    setShowRollbackWarning(true);
  };

  // Get status indicator color
  const getStatusColor = () => {
    switch (status) {
      case "installed":
        return "bg-green-500";
      case "outdated":
        return "bg-yellow-500";
      case "not-found":
      case "error":
        return "bg-destructive";
      default:
        return "bg-muted-foreground";
    }
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (status) {
      case "loading":
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case "installed":
        return <Check className="h-3 w-3" />;
      case "outdated":
        return <AlertTriangle className="h-3 w-3" />;
      case "not-found":
        return <X className="h-3 w-3" />;
      case "error":
        return <AlertTriangle className="h-3 w-3" />;
    }
  };

  // Get tooltip text
  const getTooltipText = () => {
    switch (status) {
      case "loading":
        return t("navigation:claudeCode.checking", "Checking Claude Code...");
      case "installed":
        return t("navigation:claudeCode.upToDate", "Claude Code is up to date");
      case "outdated":
        return t("navigation:claudeCode.updateAvailable", "Claude Code update available");
      case "not-found":
        return t("navigation:claudeCode.notInstalled", "Claude Code not installed");
      case "error":
        return t("navigation:claudeCode.error", "Error checking Claude Code");
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "w-full justify-start gap-2 text-xs",
                status === "not-found" || status === "error" ? "text-destructive" : "",
                status === "outdated" ? "text-yellow-600 dark:text-yellow-500" : "",
                className
              )}
            >
              <div className="relative">
                <Terminal className="h-4 w-4" />
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full",
                    getStatusColor()
                  )}
                />
              </div>
              <span className="truncate">Claude Code</span>
              {status === "outdated" && (
                <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded">
                  {t("common:update", "Update")}
                </span>
              )}
              {status === "not-found" && (
                <span className="ml-auto text-[10px] bg-destructive/20 text-destructive px-1.5 py-0.5 rounded">
                  {t("common:install", "Install")}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{getTooltipText()}</TooltipContent>
      </Tooltip>

      <PopoverContent side="right" align="end" className="w-72">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Terminal className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h4 className="text-sm font-medium">Claude Code CLI</h4>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {getStatusIcon()}
                {status === "installed" && t("navigation:claudeCode.installed", "Installed")}
                {status === "outdated" && t("navigation:claudeCode.outdated", "Update available")}
                {status === "not-found" && t("navigation:claudeCode.missing", "Not installed")}
                {status === "loading" && t("navigation:claudeCode.checking", "Checking...")}
                {status === "error" && t("navigation:claudeCode.error", "Error")}
              </p>
            </div>
          </div>

          {/* Version info */}
          {versionInfo && status !== "loading" && (
            <div className="text-xs space-y-1 p-2 bg-muted rounded-md">
              {versionInfo.installed && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("navigation:claudeCode.current", "Current")}:
                  </span>
                  <span className="font-mono">{versionInfo.installed}</span>
                </div>
              )}
              {versionInfo.latest && versionInfo.latest !== "unknown" && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("navigation:claudeCode.latest", "Latest")}:
                  </span>
                  <span className="font-mono">{versionInfo.latest}</span>
                </div>
              )}
              {versionInfo.path && (
                <div className="flex justify-between items-center gap-2">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <FolderOpen className="h-3 w-3" />
                    {t("navigation:claudeCode.path", "Path")}:
                  </span>
                  <span
                    className="font-mono text-[10px] truncate max-w-[140px]"
                    title={versionInfo.path}
                  >
                    {versionInfo.path}
                  </span>
                </div>
              )}
              {lastChecked && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("navigation:claudeCode.lastChecked", "Last checked")}:</span>
                  <span>{lastChecked.toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {(status === "not-found" || status === "outdated") && (
              <Button
                size="sm"
                className="flex-1 gap-1"
                onClick={handleInstall}
                disabled={isInstalling}
              >
                {isInstalling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                {status === "outdated"
                  ? t("common:update", "Update")
                  : t("common:install", "Install")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => checkVersion()}
              disabled={status === "loading"}
            >
              <RefreshCw className={cn("h-3 w-3", status === "loading" && "animate-spin")} />
              {t("common:refresh", "Refresh")}
            </Button>
          </div>

          {/* Install/Update error display */}
          {installError && (
            <div className="text-xs p-2 bg-destructive/10 text-destructive rounded-md flex items-center gap-2">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>{installError}</span>
            </div>
          )}

          {/* Version selector - only show when Claude is installed */}
          {versionInfo?.installed && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                {t("navigation:claudeCode.switchVersion", "Switch Version")}
              </label>
              <Select
                value={selectedVersion || ""}
                onValueChange={handleVersionSelect}
                disabled={isLoadingVersions || isInstalling}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={
                      isLoadingVersions
                        ? t("navigation:claudeCode.loadingVersions", "Loading versions...")
                        : versionsError
                          ? t("navigation:claudeCode.failedToLoadVersions", "Failed to load versions")
                          : t("navigation:claudeCode.selectVersion", "Select version")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableVersions.map((version) => {
                    const isCurrentVersion = normalizeVersion(version) === normalizeVersion(versionInfo.installed || '');
                    return (
                      <SelectItem
                        key={version}
                        value={version}
                        className="text-xs"
                        disabled={isCurrentVersion}
                      >
                        <span className="font-mono">{version}</span>
                        {isCurrentVersion && (
                          <span className="ml-2 text-muted-foreground">
                            ({t("navigation:claudeCode.currentVersion", "Current")})
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* CLI Installation selector - show when multiple installations are found */}
          {installations.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                {t("navigation:claudeCode.switchInstallation", "Switch Installation")}
              </label>
              <Select
                value={selectedInstallation || ""}
                onValueChange={handleInstallationSelect}
                disabled={isLoadingInstallations || isInstalling}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={
                      isLoadingInstallations
                        ? t("navigation:claudeCode.loadingInstallations", "Loading installations...")
                        : installationsError
                          ? t("navigation:claudeCode.failedToLoadInstallations", "Failed to load installations")
                          : t("navigation:claudeCode.selectInstallation", "Select installation")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {installations.map((installation) => (
                    <SelectItem
                      key={installation.path}
                      value={installation.path}
                      className="text-xs"
                      disabled={installation.isActive}
                    >
                      <div className="flex flex-col">
                        <span className="font-mono text-[10px] truncate max-w-[180px]" title={installation.path}>
                          {/* Split on both path separators for cross-platform compatibility */}
                          {installation.path.split(/[/\\]/).slice(-2).join('/') || installation.path}
                        </span>
                        <span className="text-muted-foreground text-[9px]">
                          {installation.version ? `v${installation.version}` : t("navigation:claudeCode.versionUnknown", "version unknown")} ({installation.source})
                          {installation.isActive && ` - ${t("navigation:claudeCode.activeInstallation", "Active")}`}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Changelog link */}
          <Button
            variant="link"
            size="sm"
            className="w-full text-xs text-muted-foreground gap-1"
            onClick={() =>
              window.electronAPI?.openExternal?.(
                "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md"
              )
            }
            aria-label={t(
              "navigation:claudeCode.viewChangelogAriaLabel",
              "View Claude Code Changelog (opens in new window)"
            )}
          >
            {t("navigation:claudeCode.viewChangelog", "View Claude Code Changelog")}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Button>
        </div>
      </PopoverContent>

      {/* Update warning dialog */}
      <AlertDialog open={showUpdateWarning} onOpenChange={setShowUpdateWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("navigation:claudeCode.updateWarningTitle", "Update Claude Code?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "navigation:claudeCode.updateWarningDescription",
                "Updating will close all running Claude Code sessions. Any unsaved work in those sessions may be lost. Make sure to save your work before proceeding."
              )}
              <span className="block mt-2 font-semibold text-foreground">
                {t(
                  "navigation:claudeCode.updateWarningTerminalNote",
                  "A terminal window will open to run the installation command. Please wait for the installation to complete before continuing."
                )}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={performInstall}>
              {t("navigation:claudeCode.updateAnyway", "Open Terminal & Update")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Version rollback warning dialog */}
      <AlertDialog open={showRollbackWarning} onOpenChange={setShowRollbackWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("navigation:claudeCode.rollbackWarningTitle", "Switch to version {{version}}?", {
                version: selectedVersion,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "navigation:claudeCode.rollbackWarningDescription",
                "Switching versions will close all running Claude Code sessions. Any unsaved work in those sessions may be lost. Make sure to save your work before proceeding."
              )}
              <span className="block mt-2 font-semibold text-foreground">
                {t(
                  "navigation:claudeCode.rollbackWarningTerminalNote",
                  "A terminal window will open to run the installation command. Please wait for the installation to complete before continuing."
                )}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedVersion(null)}>
              {t("common:cancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={performVersionSwitch}>
              {t("navigation:claudeCode.switchAnyway", "Open Terminal & Switch")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Path change warning dialog */}
      <AlertDialog open={showPathChangeWarning} onOpenChange={setShowPathChangeWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("navigation:claudeCode.pathChangeWarningTitle", "Switch CLI installation?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "navigation:claudeCode.pathChangeWarningDescription",
                "Switching CLI installations will use a different Claude Code binary. Any running sessions will continue using the previous installation until restarted."
              )}
              <span className="block mt-2 font-mono text-xs break-all">
                {selectedInstallation}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedInstallation(null)}>
              {t("common:cancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={performPathSwitch}>
              {t("navigation:claudeCode.switchInstallationConfirm", "Switch")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Popover>
  );
}
