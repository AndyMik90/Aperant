import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Download, X, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { AppUpdateAvailableEvent, AppUpdateProgress } from "../../shared/types";

// Poll for updates every 5 minutes
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

interface UpdateBannerProps {
  className?: string;
}

/**
 * Inline update notification banner for the sidebar.
 * Shows when a new application update is available and provides
 * quick access to download/install or dismiss.
 */
export function UpdateBanner({ className }: UpdateBannerProps) {
  const { t } = useTranslation(["navigation", "common"]);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateAvailableEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<AppUpdateProgress | null>(null);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Ref to track current version for stable callbacks
  const currentVersionRef = useRef<string | null>(null);

  // Check for updates
  const checkForUpdate = useCallback(async () => {
    try {
      if (!window.electronAPI?.checkAppUpdate) {
        return;
      }

      const result = await window.electronAPI.checkAppUpdate();
      if (result.success && result.data) {
        const newVersion = result.data.version;
        // New update available - show banner (unless same version already dismissed)
        if (currentVersionRef.current !== newVersion) {
          setIsDismissed(false);
          // Reset downloaded state when a newer version is found
          setIsDownloaded(false);
          currentVersionRef.current = newVersion;
        }
        setUpdateInfo({
          version: newVersion,
          releaseNotes: result.data.releaseNotes,
          releaseDate: result.data.releaseDate,
        });
      }
    } catch (_err) {
      // Silent failure - update check is non-critical
    }
  }, []);

  // Check if there's already a downloaded update on mount
  useEffect(() => {
    const checkDownloaded = async () => {
      try {
        if (!window.electronAPI?.getDownloadedAppUpdate) {
          return;
        }
        const result = await window.electronAPI.getDownloadedAppUpdate();
        if (result.success && result.data) {
          currentVersionRef.current = result.data.version;
          setUpdateInfo({
            version: result.data.version,
            releaseNotes: result.data.releaseNotes,
            releaseDate: result.data.releaseDate,
          });
          setIsDownloaded(true);
        }
      } catch {
        // Silent failure
      }
    };
    checkDownloaded();
  }, []);

  // Initial check and periodic polling
  useEffect(() => {
    checkForUpdate();

    const interval = setInterval(() => {
      checkForUpdate();
    }, UPDATE_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkForUpdate]);

  // Listen for push notifications about updates
  useEffect(() => {
    if (!window.electronAPI?.onAppUpdateAvailable) {
      return;
    }

    const cleanup = window.electronAPI.onAppUpdateAvailable((info) => {
      // New update notification - reset dismiss state if new version
      if (currentVersionRef.current !== info.version) {
        setIsDismissed(false);
        currentVersionRef.current = info.version;
      }
      setUpdateInfo(info);
      setIsDownloading(false);
      setIsDownloaded(false);
      setDownloadProgress(null);
      setDownloadError(null);
    });

    return cleanup;
  }, []);

  // Listen for download progress
  useEffect(() => {
    if (!window.electronAPI?.onAppUpdateProgress) {
      return;
    }

    const cleanup = window.electronAPI.onAppUpdateProgress((progress) => {
      setDownloadProgress(progress);
    });

    return cleanup;
  }, []);

  // Listen for download completed
  useEffect(() => {
    if (!window.electronAPI?.onAppUpdateDownloaded) {
      return;
    }

    const cleanup = window.electronAPI.onAppUpdateDownloaded(() => {
      setIsDownloading(false);
      setIsDownloaded(true);
      setDownloadProgress(null);
    });

    return cleanup;
  }, []);

  // Handle update and restart
  const handleUpdate = async () => {
    if (isDownloaded) {
      // Already downloaded - just install
      window.electronAPI?.installAppUpdate?.();
      return;
    }

    // Start download
    setIsDownloading(true);
    setDownloadError(null);

    try {
      if (!window.electronAPI?.downloadAppUpdate) {
        setDownloadError(t("navigation:updateBanner.downloadError"));
        setIsDownloading(false);
        return;
      }
      const result = await window.electronAPI.downloadAppUpdate();
      if (!result.success) {
        setDownloadError(result.error || t("navigation:updateBanner.downloadError"));
        setIsDownloading(false);
      }
    } catch (_error) {
      setDownloadError(t("navigation:updateBanner.downloadError"));
      setIsDownloading(false);
    }
  };

  // Handle dismiss
  const handleDismiss = () => {
    setIsDismissed(true);
  };

  // Don't render if no update or dismissed
  if (!updateInfo || isDismissed) {
    return null;
  }

  return (
    <div
      className={cn(
        "mx-3 mb-3 rounded-lg border border-info/30 bg-info/10 p-3",
        className
      )}
    >
      {/* Header with version and dismiss */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-info shrink-0" />
          <span className="text-xs font-medium text-foreground">
            {t("navigation:updateBanner.title")}
          </span>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t("navigation:updateBanner.dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Version info */}
      <p className="text-xs text-muted-foreground mb-3">
        {t("navigation:updateBanner.version", { version: updateInfo.version })}
      </p>

      {/* Download progress */}
      {isDownloading && downloadProgress && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>{t("navigation:updateBanner.downloading")}</span>
            <span>{Math.round(downloadProgress.percent)}%</span>
          </div>
          <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-info transition-all duration-300"
              style={{ width: `${downloadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Error message */}
      {downloadError && (
        <p className="text-[10px] text-destructive mb-2">{downloadError}</p>
      )}

      {/* Action button */}
      <Button
        size="sm"
        className="w-full h-7 text-xs gap-1.5"
        onClick={handleUpdate}
        disabled={isDownloading}
      >
        {isDownloading ? (
          <>
            <RefreshCw className="h-3 w-3 animate-spin" />
            {t("navigation:updateBanner.downloading")}
          </>
        ) : isDownloaded ? (
          <>
            <RefreshCw className="h-3 w-3" />
            {t("navigation:updateBanner.installAndRestart")}
          </>
        ) : (
          <>
            <Download className="h-3 w-3" />
            {t("navigation:updateBanner.updateAndRestart")}
          </>
        )}
      </Button>
    </div>
  );
}
