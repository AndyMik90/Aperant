import { useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import {
  useChangelogStore,
  loadChangelogData,
  loadGitData,
  loadCommitsPreview,
  generateChangelog,
  saveChangelog,
  copyChangelogToClipboard,
  canGenerate as canGenerateSelector
} from '../../../stores/changelog-store';
import { loadTasks } from '../../../stores/task-store';

export type WizardStep = 1 | 2 | 3;

export function useChangelog() {
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);

  // Data state
  const doneTasks = useChangelogStore((state) => state.doneTasks);
  const selectedTaskIds = useChangelogStore((state) => state.selectedTaskIds);
  const existingChangelog = useChangelogStore((state) => state.existingChangelog);

  // Source mode state
  const sourceMode = useChangelogStore((state) => state.sourceMode);

  // Git data state
  const branches = useChangelogStore((state) => state.branches);
  const tags = useChangelogStore((state) => state.tags);
  const currentBranch = useChangelogStore((state) => state.currentBranch);
  const defaultBranch = useChangelogStore((state) => state.defaultBranch);
  const previewCommits = useChangelogStore((state) => state.previewCommits);
  const isLoadingGitData = useChangelogStore((state) => state.isLoadingGitData);
  const isLoadingCommits = useChangelogStore((state) => state.isLoadingCommits);

  // Git history options state
  const gitHistoryType = useChangelogStore((state) => state.gitHistoryType);
  const gitHistoryCount = useChangelogStore((state) => state.gitHistoryCount);
  const gitHistorySinceDate = useChangelogStore((state) => state.gitHistorySinceDate);
  const gitHistoryFromTag = useChangelogStore((state) => state.gitHistoryFromTag);
  const gitHistoryToTag = useChangelogStore((state) => state.gitHistoryToTag);
  const gitHistorySinceVersion = useChangelogStore((state) => state.gitHistorySinceVersion);
  const includeMergeCommits = useChangelogStore((state) => state.includeMergeCommits);

  // Branch diff options state
  const baseBranch = useChangelogStore((state) => state.baseBranch);
  const compareBranch = useChangelogStore((state) => state.compareBranch);

  // Generation config state
  const version = useChangelogStore((state) => state.version);
  const date = useChangelogStore((state) => state.date);
  const format = useChangelogStore((state) => state.format);
  const audience = useChangelogStore((state) => state.audience);
  const emojiLevel = useChangelogStore((state) => state.emojiLevel);
  const customInstructions = useChangelogStore((state) => state.customInstructions);
  const generationProgress = useChangelogStore((state) => state.generationProgress);
  const generatedChangelog = useChangelogStore((state) => state.generatedChangelog);
  const isGenerating = useChangelogStore((state) => state.isGenerating);
  const error = useChangelogStore((state) => state.error);

  // Task actions
  const toggleTaskSelection = useChangelogStore((state) => state.toggleTaskSelection);
  const selectAllTasks = useChangelogStore((state) => state.selectAllTasks);
  const deselectAllTasks = useChangelogStore((state) => state.deselectAllTasks);

  // Source mode actions
  const setSourceMode = useChangelogStore((state) => state.setSourceMode);

  // Git history options actions
  const setGitHistoryType = useChangelogStore((state) => state.setGitHistoryType);
  const setGitHistoryCount = useChangelogStore((state) => state.setGitHistoryCount);
  const setGitHistorySinceDate = useChangelogStore((state) => state.setGitHistorySinceDate);
  const setGitHistoryFromTag = useChangelogStore((state) => state.setGitHistoryFromTag);
  const setGitHistoryToTag = useChangelogStore((state) => state.setGitHistoryToTag);
  const setGitHistorySinceVersion = useChangelogStore((state) => state.setGitHistorySinceVersion);
  const setIncludeMergeCommits = useChangelogStore((state) => state.setIncludeMergeCommits);

  // Branch diff options actions
  const setBaseBranch = useChangelogStore((state) => state.setBaseBranch);
  const setCompareBranch = useChangelogStore((state) => state.setCompareBranch);

  // Generation config actions
  const setVersion = useChangelogStore((state) => state.setVersion);
  const setDate = useChangelogStore((state) => state.setDate);
  const setFormat = useChangelogStore((state) => state.setFormat);
  const setAudience = useChangelogStore((state) => state.setAudience);
  const setEmojiLevel = useChangelogStore((state) => state.setEmojiLevel);
  const setCustomInstructions = useChangelogStore((state) => state.setCustomInstructions);
  const updateGeneratedChangelog = useChangelogStore((state) => state.updateGeneratedChangelog);
  const setError = useChangelogStore((state) => state.setError);
  const setIsGenerating = useChangelogStore((state) => state.setIsGenerating);
  const setGenerationProgress = useChangelogStore((state) => state.setGenerationProgress);
  const reset = useChangelogStore((state) => state.reset);

  const [step, setStep] = useState<WizardStep>(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [versionReason, setVersionReason] = useState<string | null>(null);

  // Initialize changelog preferences from settings on mount
  const initializeFromSettings = useChangelogStore((state) => state.initializeFromSettings);
  useEffect(() => {
    initializeFromSettings();
  }, [initializeFromSettings]);

  // Load data when project changes
  useEffect(() => {
    if (selectedProjectId) {
      loadChangelogData(selectedProjectId);
      loadGitData(selectedProjectId);
    }
  }, [selectedProjectId]);

  // Load commits preview when source mode or options change
  const handleLoadCommitsPreview = useCallback(() => {
    if (selectedProjectId && (sourceMode === 'git-history' || sourceMode === 'branch-diff')) {
      loadCommitsPreview(selectedProjectId);
    }
  }, [selectedProjectId, sourceMode]);

  // Set up event listeners for generation
  useEffect(() => {
    const cleanupProgress = window.electronAPI.onChangelogGenerationProgress(
      (projectId, progress) => {
        if (projectId === selectedProjectId) {
          setGenerationProgress(progress);
        }
      }
    );

    const cleanupComplete = window.electronAPI.onChangelogGenerationComplete(
      (projectId, result) => {
        if (projectId === selectedProjectId) {
          setIsGenerating(false);
          if (result.success) {
            updateGeneratedChangelog(result.changelog);
            setGenerationProgress({
              stage: 'complete',
              progress: 100,
              message: 'Changelog generated successfully!'
            });
          } else {
            setError(result.error || 'Generation failed');
          }
        }
      }
    );

    const cleanupError = window.electronAPI.onChangelogGenerationError(
      (projectId, errorMsg) => {
        if (projectId === selectedProjectId) {
          setIsGenerating(false);
          setError(errorMsg);
          setGenerationProgress({
            stage: 'error',
            progress: 0,
            message: errorMsg,
            error: errorMsg
          });
        }
      }
    );

    return () => {
      cleanupProgress();
      cleanupComplete();
      cleanupError();
    };
  }, [selectedProjectId, setError, setGenerationProgress, setIsGenerating, updateGeneratedChangelog]);

  const handleGenerate = async () => {
    if (selectedProjectId) {
      await generateChangelog(selectedProjectId);
    }
  };

  const handleSave = async () => {
    if (selectedProjectId) {
      const success = await saveChangelog(selectedProjectId, 'prepend');
      if (success) {
        setSaveSuccess(true);
        setTimeout(() => {
          setSaveSuccess(false);
          setStep(3);
        }, 1000);
      }
    }
  };

  const handleCopy = () => {
    const success = copyChangelogToClipboard();
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleContinue = async () => {
    if (selectedProjectId) {
      try {
        // Use different version suggestion based on source mode
        if (sourceMode === 'tasks' && selectedTaskIds.length > 0) {
          // Task-based: Use rule-based suggester
          const result = await window.electronAPI.suggestChangelogVersion(
            selectedProjectId,
            selectedTaskIds
          );
          if (result.success && result.data) {
            setVersion(result.data.version);
            setVersionReason(result.data.reason);
          }
        } else if ((sourceMode === 'git-history' || sourceMode === 'branch-diff') && previewCommits.length > 0) {
          // Git-based: Use AI-powered suggester with commits
          const result = await window.electronAPI.suggestChangelogVersionFromCommits(
            selectedProjectId,
            previewCommits
          );
          if (result.success && result.data) {
            setVersion(result.data.version);
            setVersionReason(result.data.reason);
          }
        }
      } catch (error) {
        console.error('Failed to suggest version:', error);
        setVersionReason(null);
      }
    }
    setStep(2);
  };

  const handleBack = () => {
    setStep(1);
  };

  const handleDone = async () => {
    reset();
    setStep(1);
    if (selectedProjectId) {
      await loadTasks(selectedProjectId);
      loadChangelogData(selectedProjectId);
    }
  };

  const canGenerate = canGenerateSelector();
  const canSave = generatedChangelog.length > 0 && !isGenerating;

  const canContinue = (() => {
    switch (sourceMode) {
      case 'tasks':
        return selectedTaskIds.length > 0;
      case 'git-history':
        return previewCommits.length > 0;
      case 'branch-diff':
        return baseBranch !== '' && compareBranch !== '' && baseBranch !== compareBranch && previewCommits.length > 0;
      default:
        return false;
    }
  })();

  return {
    // State
    selectedProjectId,
    doneTasks,
    selectedTaskIds,
    existingChangelog,
    sourceMode,
    branches,
    tags,
    currentBranch,
    defaultBranch,
    previewCommits,
    isLoadingGitData,
    isLoadingCommits,
    gitHistoryType,
    gitHistoryCount,
    gitHistorySinceDate,
    gitHistoryFromTag,
    gitHistoryToTag,
    gitHistorySinceVersion,
    includeMergeCommits,
    baseBranch,
    compareBranch,
    version,
    date,
    format,
    audience,
    emojiLevel,
    customInstructions,
    generationProgress,
    generatedChangelog,
    isGenerating,
    error,
    step,
    showAdvanced,
    saveSuccess,
    copySuccess,
    versionReason,
    canGenerate,
    canSave,
    canContinue,
    // Actions
    toggleTaskSelection,
    selectAllTasks,
    deselectAllTasks,
    setSourceMode,
    setGitHistoryType,
    setGitHistoryCount,
    setGitHistorySinceDate,
    setGitHistoryFromTag,
    setGitHistoryToTag,
    setGitHistorySinceVersion,
    setIncludeMergeCommits,
    setBaseBranch,
    setCompareBranch,
    setVersion,
    setDate,
    setFormat,
    setAudience,
    setEmojiLevel,
    setCustomInstructions,
    updateGeneratedChangelog,
    setShowAdvanced,
    setStep,
    handleLoadCommitsPreview,
    handleGenerate,
    handleSave,
    handleCopy,
    handleContinue,
    handleBack,
    handleDone,
    handleRefresh: () => selectedProjectId && loadChangelogData(selectedProjectId)
  };
}
