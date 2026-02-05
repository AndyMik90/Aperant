import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw, CheckCircle2, AlertCircle, AlertTriangle, ExternalLink } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import type { AppUpdateAvailableEvent, AppUpdateProgress } from "../../shared/types";

const CLAUDE_CODE_CHANGELOG_URL =
  "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md";

// createSafeLink - factory function that creates a SafeLink component with i18n support
const createSafeLink = (opensInNewWindowText: string) => {
  return function SafeLink({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    // Validate URL - only allow http, https, and relative links
    const isValidUrl =
      href &&
      (href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("/") ||
        href.startsWith("#"));

    if (!isValidUrl) {
      // For invalid or potentially malicious URLs, render as plain text
      return <span className="text-muted-foreground">{children}</span>;
    }

    // External links get security attributes and accessibility indicator
    const isExternal = href?.startsWith("http://") || href?.startsWith("https://");

    return (
      <a
        href={href}
        {...props}
        {...(isExternal && {
          target: "_blank",
          rel: "noopener noreferrer",
        })}
        className="text-primary hover:underline"
      >
        {children}
        {isExternal && <span className="sr-only"> {opensInNewWindowText}</span>}
      </a>
    );
  };
};

/**
 * App Update Notification Dialog
 * Shows when a new app version is available and handles download/install workflow
 */
export function AppUpdateNotification() {
  const { t } = useTranslation(["dialogs", "common"]);
  const [isOpen, setIsOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateAvailableEvent | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<AppUpdateProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showReadOnlyWarning, setShowReadOnlyWarning] = useState(false);

  // Create markdown components with translated accessibility text
  const markdownComponents: Components = useMemo(
    () => ({
      a: createSafeLink(t("common:accessibility.opensInNewWindow")),
    }),
    [t]
  );

  // Listen for update available event
  useEffect(() => {
    const cleanup = window.electronAPI.onAppUpdateAvailable((info) => {
      setUpdateInfo(info);
      setIsOpen(true);
      setIsDownloading(false);
      setIsDownloaded(false);
      setDownloadProgress(null);
      setDownloadError(null);
      setShowReadOnlyWarning(false);
    });

    return cleanup;
  }, []);

  // Listen for update downloaded event
  useEffect(() => {
    const cleanup = window.electronAPI.onAppUpdateDownloaded((_info) => {
      setIsDownloading(false);
      setIsDownloaded(true);
      setDownloadProgress(null);
      setDownloadError(null);
      setShowReadOnlyWarning(false);
    });

    return cleanup;
  }, []);

  // Listen for download progress
  useEffect(() => {
    const cleanup = window.electronAPI.onAppUpdateProgress((progress) => {
      setDownloadProgress(progress);
    });

    return cleanup;
  }, []);

  // Listen for update errors (e.g., install failures)
  useEffect(() => {
    const cleanup = window.electronAPI.onAppUpdateError((error) => {
      setDownloadError(error.message);
      setIsDownloading(false);
      setDownloadProgress(null);
    });

    return cleanup;
  }, []);

  // Listen for read-only volume warning (when trying to install from DMG on macOS)
  useEffect(() => {
    const cleanup = window.electronAPI.onAppUpdateReadOnlyVolume(() => {
      setShowReadOnlyWarning(true);
    });

    return cleanup;
  }, []);

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const result = await window.electronAPI.downloadAppUpdate();
      if (!result.success) {
        setDownloadError(
          result.error || t("dialogs:appUpdate.downloadError", "Failed to download update")
        );
        setIsDownloading(false);
      }
    } catch (error) {
      console.error("Failed to download app update:", error);
      setDownloadError(t("dialogs:appUpdate.downloadError", "Failed to download update"));
      setIsDownloading(false);
    }
  };

  const handleInstall = () => {
    window.electronAPI.installAppUpdate();
  };

  const handleDismiss = () => {
    setIsOpen(false);
  };

  if (!updateInfo) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t("dialogs:appUpdate.title", "App Update Available")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "dialogs:appUpdate.description",
              "A new version of Auto Claude is ready to download"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Version Info */}
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  {t("dialogs:appUpdate.newVersion", "New Version")}
                </p>
                <p className="text-base font-medium text-foreground">{updateInfo.version}</p>
                {updateInfo.releaseDate && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("dialogs:appUpdate.released", "Released")}{" "}
                    {new Date(updateInfo.releaseDate).toLocaleDateString()}
                  </p>
                )}
              </div>
              {isDownloaded ? (
                <CheckCircle2 className="h-6 w-6 text-success" />
              ) : isDownloading ? (
                <RefreshCw className="h-6 w-6 animate-spin text-info" />
              ) : (
                <Download className="h-6 w-6 text-info" />
              )}
            </div>
          </div>

          {/* Release Notes */}
          {updateInfo.releaseNotes && (
            <div className="bg-background rounded-lg p-4 max-h-64 overflow-y-auto border border-border/50">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, rehypeSanitize]}
                  components={markdownComponents}
                >
                  {updateInfo.releaseNotes}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Claude Code Changelog Link */}
          <Button
            variant="link"
            size="sm"
            className="w-full text-xs text-muted-foreground gap-1"
            onClick={() => window.electronAPI.openExternal(CLAUDE_CODE_CHANGELOG_URL)}
            aria-label={t(
              "dialogs:appUpdate.claudeCodeChangelogAriaLabel",
              "View Claude Code Changelog (opens in new window)"
            )}
          >
            {t("dialogs:appUpdate.claudeCodeChangelog", "View Claude Code Changelog")}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Button>

          {/* Download Progress */}
          {isDownloading && downloadProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("dialogs:appUpdate.downloading", "Downloading...")}
                </span>
                <span className="text-foreground font-medium">
                  {Math.round(downloadProgress.percent)}%
                </span>
              </div>
              <Progress value={downloadProgress.percent} className="h-2" />
              <p className="text-xs text-muted-foreground text-right">
                {(downloadProgress.transferred / 1024 / 1024).toFixed(2)} MB /{" "}
                {(downloadProgress.total / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          )}

          {/* Download Error */}
          {downloadError && (
            <div className="flex items-center gap-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{downloadError}</span>
            </div>
          )}

          {/* Read-Only Volume Warning (DMG install on macOS) */}
          {showReadOnlyWarning && (
            <div className="flex items-start gap-3 text-sm text-warning bg-warning/10 border border-warning/30 rounded-lg p-3">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">
                  {t("dialogs:appUpdate.readOnlyVolumeTitle", "Cannot install from disk image")}
                </p>
                <p className="text-muted-foreground">
                  {t("dialogs:appUpdate.readOnlyVolumeDescription", "Please move Auto Claude to your Applications folder before updating.")}
                </p>
              </div>
            </div>
          )}

          {/* Downloaded Success */}
          {isDownloaded && !showReadOnlyWarning && (
            <div className="flex items-center gap-3 text-sm text-success bg-success/10 border border-success/30 rounded-lg p-3">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>
                {t(
                  "dialogs:appUpdate.updateDownloaded",
                  "Update downloaded successfully! Click Install to restart and apply the update."
                )}
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-3">
          <Button variant="outline" onClick={handleDismiss} disabled={isDownloading}>
            {isDownloaded
              ? t("dialogs:appUpdate.installLater", "Install Later")
              : t("dialogs:appUpdate.remindMeLater", "Remind Me Later")}
          </Button>

          {isDownloaded ? (
            <Button onClick={handleInstall} disabled={showReadOnlyWarning}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("dialogs:appUpdate.installAndRestart", "Install and Restart")}
            </Button>
          ) : (
            <Button onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t("dialogs:appUpdate.downloading", "Downloading...")}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  {t("dialogs:appUpdate.downloadUpdate", "Download Update")}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
