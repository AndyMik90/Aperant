import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Terminal,
  Check,
  AlertTriangle,
  X,
  Loader2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";
import type { ClaudeCodeVersionInfo } from "../../shared/types/cli";

interface ClaudeCodeStatusBadgeProps {
  className?: string;
}

type StatusType = "loading" | "installed" | "outdated" | "not-found" | "error";

// Check every 24 hours
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Claude Code CLI status badge for the sidebar.
 * Shows installation status with a tooltip on hover.
 */
export function ClaudeCodeStatusBadge({ className }: ClaudeCodeStatusBadgeProps) {
  const { t } = useTranslation(["common", "navigation"]);
  const [status, setStatus] = useState<StatusType>("loading");
  const [versionInfo, setVersionInfo] = useState<ClaudeCodeVersionInfo | null>(null);

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
    } catch {
      setStatus("error");
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

  // Get tooltip text
  const getTooltipText = () => {
    switch (status) {
      case "loading":
        return t("navigation:claudeCode.checking", "Checking Claude Code...");
      case "installed":
        return versionInfo?.installed
          ? t("navigation:claudeCode.upToDateWithVersion", "Claude Code {{version}} installed", {
              version: versionInfo.installed,
            })
          : t("navigation:claudeCode.upToDate", "Claude Code is up to date");
      case "outdated":
        return t("navigation:claudeCode.updateAvailable", "Claude Code update available");
      case "not-found":
        return t("navigation:claudeCode.notInstalled", "Claude Code not installed");
      case "error":
        return t("navigation:claudeCode.error", "Error checking Claude Code");
    }
  };

  // Get status icon for the badge
  const getStatusIcon = () => {
    switch (status) {
      case "loading":
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case "installed":
        return <Check className="h-3 w-3" />;
      case "outdated":
        return <AlertTriangle className="h-3 w-3" />;
      case "not-found":
      case "error":
        return <X className="h-3 w-3" />;
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 text-xs rounded-md",
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
            <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded flex items-center gap-1">
              {getStatusIcon()}
              {t("common:update", "Update")}
            </span>
          )}
          {status === "not-found" && (
            <span className="ml-auto text-[10px] bg-destructive/20 text-destructive px-1.5 py-0.5 rounded flex items-center gap-1">
              {getStatusIcon()}
              {t("common:install", "Install")}
            </span>
          )}
          {status === "installed" && (
            <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1">
              {getStatusIcon()}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">{getTooltipText()}</TooltipContent>
    </Tooltip>
  );
}
