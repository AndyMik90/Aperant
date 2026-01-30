import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import {
	CheckCircle2,
	AlertCircle,
	FileText,
	Search,
	Settings,
	Tag,
	TrendingUp,
	Loader2,
	MessageSquare,
} from 'lucide-react';
import type { LinearTicket, ValidationResult } from '@shared/types';
import { createTaskFromLinearTicket, useLinearStore } from '../../../stores/linear-store';
import { cn } from '../../../lib/utils';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '../../ui/dialog';
import { Card, CardContent } from '../../ui/card';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '../../ui/collapsible';

interface ValidationResultsProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	ticket: LinearTicket;
	validation: ValidationResult;
}

/**
 * Build a simple clarification comment for missing required fields.
 * This posts to Linear (which syncs to GitHub) to request information from the reporter.
 */
export function buildClarificationComment(
	ticket: LinearTicket,
	validation: ValidationResult,
	t: (key: string, params?: Record<string, string | number>) => string
): string {
	const lines: string[] = [];

	// Simple header
	lines.push(`## 📝 Clarification Needed: ${ticket.identifier}`);
	lines.push('');
	lines.push(`This ticket requires additional information to proceed with implementation.`);
	lines.push('');

	// Missing fields
	if (validation.completenessValidation?.missingFields?.length > 0) {
		lines.push(`### ❌ Missing Information`);
		lines.push('');
		lines.push(`Please provide details for the following required fields:`);
		lines.push('');
		validation.completenessValidation.missingFields.forEach((field) => {
			lines.push(`- **${field}**`);
		});
		lines.push('');
	}

	// Call to action
	lines.push(`---`);
	lines.push('');
	lines.push(`Once you've provided the missing information, the ticket can be re-validated.`);
	lines.push('');
	lines.push(`*Posted by Auto-Claude validation system*`);

	return lines.join('\n');
}

/**
 * Build a formatted comment content from validation results for posting to Linear.
 */
export function buildFeedbackComment(
	ticket: LinearTicket,
	validation: ValidationResult,
	t: (key: string, params?: Record<string, string | number>) => string
): string {
	const lines: string[] = [];

	// Header with ticket link
	lines.push(`## 🔍 Validation Results: ${ticket.identifier}`);
	lines.push('');
	lines.push(`**Ticket:** [${ticket.title}](${ticket.url})`);
	lines.push('');

	// Status banner
	const isComplete = validation.completenessValidation?.isComplete ?? false;
	const feasibilityScore = validation.completenessValidation?.feasibilityScore ?? 0;

	lines.push('---');
	if (isComplete) {
		lines.push(`### ✅ Ready to Implement`);
		lines.push('');
		lines.push(`**Feasibility Score:** ${feasibilityScore}%`);
	} else {
		lines.push(`### ⚠️ Needs Clarification`);
		lines.push('');
		lines.push(`**Feasibility Score:** ${feasibilityScore}%`);
	}
	lines.push('');
	lines.push('---');
	lines.push('');

	// Content analysis
	if (validation.contentAnalysis) {
		lines.push(`### 📋 Analysis`);
		lines.push('');

		lines.push(`**Objective**`);
		lines.push(`> ${validation.contentAnalysis.title}`);
		lines.push('');

		if (validation.contentAnalysis.descriptionSummary) {
			lines.push(`**Summary**`);
			lines.push(validation.contentAnalysis.descriptionSummary);
			lines.push('');
		}

		if (validation.contentAnalysis.requirements?.length > 0) {
			lines.push(`**Requirements**`);
			validation.contentAnalysis.requirements.forEach((req) => {
				lines.push(`- ${req}`);
			});
			lines.push('');
		}
	}

	// Missing fields
	if (!isComplete && validation.completenessValidation?.missingFields?.length > 0) {
		lines.push(`### ❌ Missing Information`);
		lines.push('');
		lines.push(`The following fields need more detail:`);
		lines.push('');
		validation.completenessValidation.missingFields.forEach((field) => {
			lines.push(`- \`${field}\``);
		});
		lines.push('');
	}

	// Suggested labels with confidence
	if (validation.suggestedLabels?.length > 0) {
		lines.push(`### 🏷️ Suggested Labels`);
		lines.push('');
		validation.suggestedLabels.forEach((label) => {
			const name = typeof label === 'string' ? label : label.name;
			const confidence = typeof label === 'object' ? label.confidence : null;
			if (confidence) {
				lines.push(`- \`${name}\` (${confidence}% confidence)`);
			} else {
				lines.push(`- \`${name}\``);
			}
		});
		lines.push('');
	}

	// Task properties
	if (validation.taskProperties) {
		lines.push(`### ⚙️ Task Properties`);
		lines.push('');
		lines.push(`| Property | Value |`);
		lines.push(`|----------|-------|`);
		lines.push(`| **Category** | \`${validation.taskProperties.category}\` |`);
		lines.push(`| **Complexity** | \`${validation.taskProperties.complexity}\` |`);
		lines.push(`| **Impact** | \`${validation.taskProperties.impact}\` |`);
		lines.push(`| **Priority** | \`${validation.taskProperties.priority}\` |`);
		lines.push('');

		if (validation.taskProperties.rationale) {
			lines.push(`**Rationale:** ${validation.taskProperties.rationale}`);
			lines.push('');
		}
	}

	// Version recommendation
	if (validation.versionRecommendation?.recommendedVersion) {
		lines.push(`### 📦 Version Recommendation`);
		lines.push('');
		lines.push(`**Recommended Version:** \`${validation.versionRecommendation.recommendedVersion}\``);
		lines.push(`**Type:** \`${validation.versionRecommendation.versionType}\``);
		if (validation.versionRecommendation.reasoning) {
			lines.push(`**Reasoning:** ${validation.versionRecommendation.reasoning}`);
		}
		lines.push('');
	}

	// Codebase verification
	if (validation.codebaseVerification) {
		lines.push(`### 🔍 Codebase Verification`);
		lines.push('');

		if (validation.codebaseVerification.searchedFiles?.length > 0) {
			lines.push(`**Files Examined:** ${validation.codebaseVerification.searchedFiles.length}`);
			validation.codebaseVerification.searchedFiles.slice(0, 5).forEach((file) => {
				lines.push(`- \`${file.length > 50 ? '...' + file.slice(-47) : file}\``);
			});
			if (validation.codebaseVerification.searchedFiles.length > 5) {
				lines.push(`- ... and ${validation.codebaseVerification.searchedFiles.length - 5} more`);
			}
			lines.push('');
		}

		if (validation.codebaseVerification.relatedImplementations?.length > 0) {
			lines.push(`**Related Code Found:** ${validation.codebaseVerification.relatedImplementations.length}`);
			lines.push('');
			validation.codebaseVerification.relatedImplementations.forEach((impl) => {
				const shortFile = impl.file.length > 40 ? '...' + impl.file.slice(-37) : impl.file;
				lines.push(`- \`${shortFile}\` - ${impl.description}`);
				if (impl.relevance) {
					lines.push(`  - *Relevance: ${impl.relevance}*`);
				}
			});
			lines.push('');
		}

		if (validation.codebaseVerification.technicalConstraints?.length > 0) {
			lines.push(`**Technical Constraints:**`);
			validation.codebaseVerification.technicalConstraints.forEach((constraint) => {
				lines.push(`- ${constraint}`);
			});
			lines.push('');
		}

		if (validation.codebaseVerification.existingSolutions) {
			lines.push(`**Existing Solutions:**`);
			lines.push(validation.codebaseVerification.existingSolutions);
			lines.push('');
		}
	}

	// Feasibility reasoning
	if (validation.completenessValidation?.feasibilityReasoning) {
		lines.push(`### 📊 Feasibility Assessment`);
		lines.push('');
		lines.push(validation.completenessValidation.feasibilityReasoning);
		lines.push('');
	}

	// Footer
	lines.push('---');
	lines.push('');
	lines.push(`*Posted by Auto-Claude validation system*`);

	return lines.join('\n');
}

/**
 * Professional validation results modal following project design patterns.
 * Card-based layout with success/warning status, collapsible sections, clean typography.
 */
export function ValidationResults({
	open,
	onOpenChange,
	ticket,
	validation,
}: ValidationResultsProps) {
	const { t } = useTranslation(['linear', 'common', 'tasks']);
	const [isCreating, setIsCreating] = useState(false);
	const [isPosting, setIsPosting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Handle create task (only for complete validations)
	const handleCreateTask = useCallback(async () => {
		setIsCreating(true);
		setError(null);

		try {
			await createTaskFromLinearTicket(ticket.id, validation);
			onOpenChange(false);
		} catch (err) {
			const errorMessage =
				err instanceof Error
					? err.message
					: t('linear:createTaskFailed', {
							defaultValue: 'Failed to create task',
						});
			setError(errorMessage);
		} finally {
			setIsCreating(false);
		}
	}, [ticket, validation, onOpenChange, t]);

	// Handle post feedback to Linear (for incomplete validations)
	// Posts both: 1) Full validation results, 2) Clarification comment as reply to GitHub thread
	const handlePostFeedback = useCallback(async () => {
		setIsPosting(true);
		setError(null);

		try {
			// Get project ID from ticket, or fall back to selected project from store
			// The backend will handle finding an API key if projectId is null
			const projectId = ticket.project?.id || useLinearStore.getState().selectedProjectId || null;

			// 1. Post the full validation results comment (top-level comment)
			const feedbackComment = buildFeedbackComment(ticket, validation, t);
			const feedbackResult = await window.electronAPI.postLinearComment(projectId, ticket.id, feedbackComment);

			if (!feedbackResult.success) {
				throw new Error(feedbackResult.error || 'Failed to post feedback comment');
			}

			// 2. If there are missing fields, also post a clarification comment
			// This will sync to GitHub via Linear's integration to request information from the reporter
			const isComplete = validation.completenessValidation?.isComplete ?? false;
			const hasMissingFields = validation.completenessValidation?.missingFields?.length > 0;

			// Note: We need a projectId to fetch comments (for finding GitHub threads)
			// If projectId is null, we skip the clarification comment but the feedback was still posted
			if (!isComplete && hasMissingFields && projectId) {
				// Fetch comments to find GitHub threads
				const commentsResult = await window.electronAPI.getLinearComments(projectId, ticket.id);

				let parentId: string | null = null;

				if (commentsResult.success && commentsResult.data) {
					// Find the first top-level comment that might be from GitHub
					// GitHub comments appear as top-level comments (without parentId)
					// We reply to the first one we find
					const githubThread = commentsResult.data.find((c) => !c.parentId);
					if (githubThread) {
						parentId = githubThread.id;
					}
				}

				const clarificationComment = buildClarificationComment(ticket, validation, t);
				const clarificationResult = await window.electronAPI.postLinearComment(
					projectId,
					ticket.id,
					clarificationComment,
					parentId, // Post as threaded reply if we found a GitHub thread
				);

				if (!clarificationResult.success) {
					throw new Error(clarificationResult.error || 'Failed to post clarification comment');
				}
			}

			// Close the modal on success
			onOpenChange(false);
		} catch (err) {
			const errorMessage =
				err instanceof Error
					? err.message
					: t('linear:postFeedbackFailed', {
							defaultValue: 'Failed to post feedback',
						});
			setError(errorMessage);
		} finally {
			setIsPosting(false);
		}
	}, [ticket, validation, onOpenChange, t]);

	// Validation status styling
	const isComplete = validation.completenessValidation?.isComplete ?? false;
	const feasibilityScore = validation.completenessValidation?.feasibilityScore ?? 0;

	// Determine validation status based on completeness and feasibility
	const getValidationStatus = () => {
		if (validation.status === 'error') {
			return {
				icon: AlertCircle,
				color: 'text-destructive',
				bgColor: 'bg-destructive/10 border-destructive/30',
				label: t('linear:validationFailed'),
				description: t('linear:validationFailedDesc'),
			};
		}
		if (isComplete) {
			return {
				icon: CheckCircle2,
				color: 'text-success',
				bgColor: 'bg-success/10 border-success/30',
				label: t('linear:validationComplete'),
				description: t('linear:validationCompleteDesc', {
					score: feasibilityScore,
				}),
			};
		}
		// Incomplete
		const missingCount = validation.completenessValidation?.missingFields?.length || 0;
		return {
			icon: AlertCircle,
			color: 'text-amber-600',
			bgColor: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
			label: t('linear:validationIncomplete'),
			description: missingCount > 0
				? t('linear:validationIncompleteWithMissing', {
						count: missingCount,
				  })
				: t('linear:validationIncompleteDesc'),
		};
	};

	const statusConfig = getValidationStatus();
	const StatusIcon = statusConfig.icon;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
				<DialogHeader className="shrink-0">
					<DialogTitle className="flex items-center gap-2">
						<StatusIcon className={cn('h-5 w-5', statusConfig.color)} />
						{statusConfig.label}
					</DialogTitle>
					<DialogDescription>
						{statusConfig.description}
					</DialogDescription>
				</DialogHeader>

				<div className="overflow-y-auto flex-1 min-h-0">
					<div className="space-y-4 p-6">
						{/* Ticket Header */}
						<div className="rounded-lg border bg-card p-4 space-y-3">
							<div className="flex items-start justify-between">
								<div>
									<h3 className="font-semibold text-base">{ticket.title}</h3>
									<a
										href={ticket.url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm text-primary hover:underline flex items-center gap-1"
									>
										{ticket.identifier}
										<FileText className="h-3 w-3" />
									</a>
								</div>
								<div className="flex items-center gap-2">
									<Badge
										variant={isComplete ? 'success' : 'secondary'}
										className="text-sm"
									>
										{feasibilityScore}% {t('linear:feasibilityScore')}
									</Badge>
									{validation.cached && (
										<Badge variant="outline" className="text-xs">
											{t('linear:cached')}
										</Badge>
									)}
								</div>
							</div>
						</div>

						{/* Description Summary */}
						{validation.contentAnalysis?.descriptionSummary && (
							<Card className="border bg-muted/30">
								<CardContent className="p-4">
									<h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
										{t('linear:description')}
									</h4>
									<p className="text-sm text-foreground leading-relaxed">
										{validation.contentAnalysis.descriptionSummary}
									</p>
								</CardContent>
							</Card>
						)}

						{/* Missing Fields Warning */}
						{!isComplete &&
							validation.completenessValidation?.missingFields &&
							validation.completenessValidation.missingFields.length > 0 && (
								<Card
									className={cn(
										'border bg-amber-50 dark:bg-amber-900/20',
										validation.completenessValidation.missingFields.length <= 2
											? 'border-amber-200 dark:border-amber-800'
											: 'border-amber-400 dark:border-amber-600',
									)}
								>
									<CardContent className="p-4">
										<div className="flex items-start gap-2">
											<AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
											<div className="flex-1">
												<p className="text-sm font-medium text-amber-900 dark:text-amber-100">
													{t('linear:missingFields', { defaultValue: 'Missing Fields' })}
												</p>
												<div className="flex flex-wrap gap-1 mt-2">
													{validation.completenessValidation.missingFields.map((field, index) => (
														<Badge
															key={index}
															variant="outline"
															className="text-xs text-amber-700 dark:text-amber-300"
														>
															{field}
														</Badge>
													))}
												</div>
											</div>
										</div>
									</CardContent>
								</Card>
							)}

						{/* Labels - Collapsible */}
						{validation.suggestedLabels && validation.suggestedLabels.length > 0 && (
							<Collapsible defaultOpen>
								<CollapsibleTrigger className="flex items-center gap-2 py-2 hover:underline">
									<Tag className="h-4 w-4 text-muted-foreground" />
									<span className="text-sm font-medium">
										{t('linear:labels')} ({validation.suggestedLabels.length})
									</span>
								</CollapsibleTrigger>
								<CollapsibleContent className="pl-6 pb-4">
									<div className="flex flex-wrap gap-1">
										{validation.suggestedLabels.map((label, index) => {
											// Handle both string labels (from Python) and object labels (from schema)
											const labelName = typeof label === 'string' ? label : label.name;

											return (
												<span
													key={index}
													className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium"
													role="listitem"
												>
													{labelName}
												</span>
											);
										})}
									</div>
								</CollapsibleContent>
							</Collapsible>
						)}

						{/* Task Properties - Collapsible */}
						{validation.taskProperties && (
							<Collapsible defaultOpen>
								<CollapsibleTrigger className="flex items-center gap-2 py-2 hover:underline">
									<Settings className="h-4 w-4 text-muted-foreground" />
									<span className="text-sm font-medium">{t('linear:taskProperties')}</span>
								</CollapsibleTrigger>
								<CollapsibleContent className="pl-6 pb-4 space-y-2">
									<div className="grid grid-cols-2 gap-2">
										<div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
											<span className="text-xs text-muted-foreground">{t('linear:category')}</span>
											<span className="text-sm font-medium">{validation.taskProperties.category}</span>
										</div>
										<div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
											<span className="text-xs text-muted-foreground">{t('linear:complexity')}</span>
											<span className="text-sm font-medium">{validation.taskProperties.complexity}</span>
										</div>
										<div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
											<span className="text-xs text-muted-foreground">{t('linear:impact')}</span>
											<span className="text-sm font-medium">{validation.taskProperties.impact}</span>
										</div>
										<div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
											<span className="text-xs text-muted-foreground">{t('linear:priority')}</span>
											<span className="text-sm font-medium">{validation.taskProperties.priority}</span>
										</div>
									</div>
								</CollapsibleContent>
							</Collapsible>
						)}

						{/* Version Recommendation - Collapsible */}
						{validation.versionRecommendation?.recommendedVersion && (
							<Collapsible defaultOpen>
								<CollapsibleTrigger className="flex items-center gap-2 py-2 hover:underline">
									<TrendingUp className="h-4 w-4 text-muted-foreground" />
									<span className="text-sm font-medium">{t('linear:recommendedVersion')}</span>
								</CollapsibleTrigger>
								<CollapsibleContent className="pl-6 pb-4">
									<div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
										<span className="text-sm text-muted-foreground">
											{validation.versionRecommendation.recommendedVersion}
										</span>
										<Badge
											variant="outline"
											className={cn(
												'text-xs',
												validation.versionRecommendation.versionType === 'major' &&
													'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
												validation.versionRecommendation.versionType === 'minor' &&
													'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
												validation.versionRecommendation.versionType === 'patch' &&
													'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
											)}
										>
											{validation.versionRecommendation.versionType}
										</Badge>
									</div>
									{validation.versionRecommendation.reasoning && (
										<p className="text-xs text-muted-foreground mt-2">
											{validation.versionRecommendation.reasoning}
										</p>
									)}
								</CollapsibleContent>
							</Collapsible>
						)}

						{/* Codebase Verification - Collapsible */}
						{validation.codebaseVerification && (
							<Collapsible>
								<CollapsibleTrigger className="flex items-center gap-2 py-2 hover:underline">
									<Search className="h-4 w-4 text-muted-foreground" />
									<span className="text-sm font-medium">{t('linear:codebaseVerification')}</span>
								</CollapsibleTrigger>
								<CollapsibleContent className="pl-6 pb-4 space-y-3">
									{validation.codebaseVerification.searchedFiles &&
										validation.codebaseVerification.searchedFiles.length > 0 && (
											<div>
												<p className="text-xs text-muted-foreground mb-2">{t('linear:filesExamined')}</p>
												<div className="flex flex-wrap gap-1">
													{validation.codebaseVerification.searchedFiles.map((file, index) => (
														<Badge
															key={index}
															variant="outline"
															className="text-xs font-mono"
														>
															{file.length > 40 ? file.slice(-40) : file}
														</Badge>
													))}
												</div>
											</div>
										)}
									{validation.codebaseVerification.relatedImplementations &&
										validation.codebaseVerification.relatedImplementations.length > 0 && (
											<div>
												<p className="text-xs text-muted-foreground mb-2">{t('linear:relatedCode')}</p>
												<div className="space-y-1">
													{validation.codebaseVerification.relatedImplementations.map((impl, index) => (
														<div
															key={index}
															className="rounded-md border bg-muted/30 p-2 text-xs"
														>
															<div className="font-mono text-xs mb-1">
																{impl.file.length > 50 ? impl.file.slice(-50) : impl.file}
															</div>
															<p className="text-xs text-muted-foreground">{impl.description}</p>
															{impl.relevance && (
																<Badge variant="outline" className="text-xs">
																	{impl.relevance}
																</Badge>
															)}
														</div>
													))}
												</div>
											</div>
										)}
								</CollapsibleContent>
							</Collapsible>
						)}

						{/* Technical Constraints - Collapsible */}
						{validation.codebaseVerification?.technicalConstraints &&
							validation.codebaseVerification.technicalConstraints.length > 0 && (
								<Collapsible>
									<CollapsibleTrigger className="flex items-center gap-2 py-2 hover:underline">
										<AlertCircle className="h-4 w-4 text-muted-foreground" />
										<span className="text-sm font-medium">{t('linear:constraints')}</span>
									</CollapsibleTrigger>
									<CollapsibleContent className="pl-6 pb-4">
										<ul className="space-y-1">
											{validation.codebaseVerification.technicalConstraints.map((constraint, index) => (
												<li key={index} className="text-xs text-muted-foreground">
													• {constraint}
												</li>
											))}
										</ul>
									</CollapsibleContent>
								</Collapsible>
							)}

						{/* Error Display */}
						{error && (
							<motion.div
								initial={{ opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								className="p-3 bg-destructive/10 border border-destructive rounded-lg text-sm text-destructive"
							>
								{error}
							</motion.div>
						)}
					</div>
				</div>

				{/* Actions - Fixed at bottom */}
				<div className="p-6 pt-4 border-t shrink-0">
					<div className="flex items-center justify-end gap-3">
						<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating || isPosting}>
							{t('common:buttons.close')}
						</Button>
						{isComplete ? (
							// Complete validation: Show "Create Task" button
							<Button onClick={handleCreateTask} disabled={isCreating}>
								{isCreating ? (
									<>
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
										{t('linear:creating')}
									</>
								) : (
									<>
										<Settings className="h-4 w-4 mr-2" />
										{t('linear:createTask')}
									</>
								)}
							</Button>
						) : (
							// Incomplete validation: Show "Post Feedback" button
							<Button onClick={handlePostFeedback} disabled={isPosting} variant="secondary">
								{isPosting ? (
									<>
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
										{t('linear:creating')}
									</>
								) : (
									<>
										<MessageSquare className="h-4 w-4 mr-2" />
										{t('linear:postFeedback')}
									</>
								)}
							</Button>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
