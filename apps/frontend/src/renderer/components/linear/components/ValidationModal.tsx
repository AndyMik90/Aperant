/**
 * ValidationModal - Modal for displaying AI-powered ticket validation results
 *
 * Refactored with professional UI patterns:
 * - Tabbed layout for progressive disclosure (Summary, Analysis, Recommendations, Completeness)
 * - Card-based sections for visual hierarchy
 * - Improved spacing and typography
 * - Better loading states
 * - Consistent with TaskDetailModal, AddProjectModal, SimilarIssuesDialog
 */

import {
	AlertCircle,
	CheckCircle2,
	Circle,
	Edit2,
	FileText,
	Loader2,
	Save,
	Search,
	Settings,
	Tag,
	Target,
	TrendingUp,
	X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
	TaskCategory,
	TaskComplexity,
	TaskImpact,
	TaskPriority,
	ValidationResult,
} from '../../../../shared/types';
import { cn } from '../../../lib/utils';
import { createTaskFromLinearTicket, useLinearStore } from '../../../stores/linear-store';
import { useLinearValidationProgress } from '../../../hooks/useLinearValidationProgress';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '../../ui/dialog';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Progress } from '../../ui/progress';
import { ScrollArea } from '../../ui/scroll-area';
import { Separator } from '../../ui/separator';
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '../../ui/tabs';
import { useValidationEditState } from './useValidationEditState';

interface ValidationModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	ticketId: string;
	validation: ValidationResult | null;
}

type ValidationStep = {
	id: string;
	label: string;
	status: 'pending' | 'in_progress' | 'complete' | 'error';
	icon: typeof CheckCircle2;
};

/**
 * ValidationModal component displays AI validation results with streaming progress
 * Refactored with tabbed layout and card-based sections for better UX
 */
export function ValidationModal({
	open,
	onOpenChange,
	ticketId,
	validation,
}: ValidationModalProps) {
	const { t } = useTranslation(['common', 'tasks', 'linear']);

	// Listen for validation progress events
	useLinearValidationProgress(ticketId);

	// Get validation progress using individual selectors to prevent infinite re-renders
	const progressUpdateCounter = useLinearStore(
		(state) => state.progressUpdateCounter,
	);
	const progressPhase = useLinearStore(
		(state) => state.validationProgress.get(ticketId)?.phase,
	);
	const progressStep = useLinearStore(
		(state) => state.validationProgress.get(ticketId)?.step,
	);
	const progressTotal = useLinearStore(
		(state) => state.validationProgress.get(ticketId)?.total,
	);
	const progressMessage = useLinearStore(
		(state) => state.validationProgress.get(ticketId)?.message,
	);

	// Memoize the progress object to prevent unnecessary re-renders
	const validationProgress: {
		phase: string;
		step: number;
		total: number;
		message: string;
	} | undefined = useMemo(() => {
		if (!progressPhase || progressStep === undefined || progressTotal === undefined) {
			return undefined;
		}
		return {
			phase: progressPhase,
			step: progressStep,
			total: progressTotal,
			message: progressMessage || '',
		};
	}, [progressPhase, progressStep, progressTotal, progressMessage, progressUpdateCounter]);

	// Use the custom edit state hook
	const editState = useValidationEditState(validation);

	// UI state
	const [activeTab, setActiveTab] = useState<'summary' | 'analysis' | 'recommendations' | 'completeness'>('summary');
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isInitialLoad, setIsInitialLoad] = useState(false);

	// Track initial loading state when modal opens
	useEffect(() => {
		if (open && !validation) {
			setIsInitialLoad(true);
		} else if (validation) {
			setIsInitialLoad(false);
		}
	}, [open, validation]);

	// Helper to get step status from validation progress
	const getStepStatus = (
		stepId: string,
		isComplete: boolean,
	): 'pending' | 'in_progress' | 'complete' | 'error' => {
		if (isComplete) return 'complete';

		if (validationProgress) {
			const { phase } = validationProgress;

			const phaseToStepId: Record<string, string> = {
				initialization: 'analyze',
				content_analysis: 'analyze',
				codebase_search: 'codebase',
				ai_analysis_start: 'completeness',
				completeness_check: 'completeness',
				labels_selection: 'labels',
				version_calculation: 'version',
				properties_recommendation: 'properties',
				ai_analysis_complete: 'properties',
			};

			const currentStepId = phaseToStepId[phase] || 'analyze';

			if (currentStepId === stepId) return 'in_progress';

			const stepOrder = ['analyze', 'codebase', 'completeness', 'labels', 'version', 'properties'];
			const currentIndex = stepOrder.indexOf(currentStepId);
			const targetIndex = stepOrder.indexOf(stepId);

			if (targetIndex < currentIndex) return 'complete';
		}

		return validation?.status === 'validating' || isInitialLoad
			? 'in_progress'
			: 'pending';
	};

	// Compute validation steps based on validation status and progress
	const validationSteps: ValidationStep[] = [
		{
			id: 'analyze',
			label: t('linear:validationSteps.analyze', {
				defaultValue: 'Analyze Content',
			}),
			status: getStepStatus('analyze', !!validation?.contentAnalysis),
			icon: FileText,
		},
		{
			id: 'codebase',
			label: t('linear:validationSteps.codebase', {
				defaultValue: 'Search Codebase',
			}),
			status: getStepStatus(
				'codebase',
				(validation?.codebaseVerification?.searchedFiles?.length ?? 0) > 0,
			),
			icon: Search,
		},
		{
			id: 'completeness',
			label: t('linear:validationSteps.completeness', {
				defaultValue: 'Validate Completeness',
			}),
			status: getStepStatus('completeness', !!validation?.completenessValidation),
			icon: CheckCircle2,
		},
		{
			id: 'labels',
			label: t('linear:validationSteps.labels', {
				defaultValue: 'Auto-Select Labels',
			}),
			status: getStepStatus('labels', (validation?.suggestedLabels?.length ?? 0) > 0),
			icon: Tag,
		},
		{
			id: 'version',
			label: t('linear:validationSteps.version', {
				defaultValue: 'Determine Version',
			}),
			status: getStepStatus('version', !!validation?.versionRecommendation),
			icon: TrendingUp,
		},
		{
			id: 'properties',
			label: t('linear:validationSteps.properties', {
				defaultValue: 'Recommend Properties',
			}),
			status: getStepStatus('properties', !!validation?.taskProperties),
			icon: Settings,
		},
	];

	// Handle create task
	const handleCreateTask = useCallback(async () => {
		if (!validation) return;

		setIsCreating(true);
		setError(null);

		try {
			const updatedValidation = editState.getUpdatedValidation();
			await createTaskFromLinearTicket(ticketId, updatedValidation);
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
	}, [validation, editState, ticketId, onOpenChange, t]);

	// Handle cancel validation
	const handleCancel = useCallback(async () => {
		if (!window.electronAPI?.cancelLinearValidation) return;

		try {
			const result = await window.electronAPI.cancelLinearValidation(ticketId);
			if (result.success) {
				useLinearStore.getState().updateValidationResult(ticketId, {
					...(validation || {
						ticketId,
						ticketIdentifier: '',
						validationTimestamp: new Date().toISOString(),
						cached: false,
						projectId: null,
						contentAnalysis: {
							title: '',
							descriptionSummary: '',
							requirements: [],
						},
						completenessValidation: {
							isComplete: false,
							missingFields: [],
							feasibilityScore: 0,
							feasibilityReasoning: '',
						},
						suggestedLabels: [],
						versionRecommendation: {
							recommendedVersion: '',
							versionType: 'patch',
							reasoning: '',
						},
						taskProperties: {
							category: 'feature',
							complexity: 'medium',
							impact: 'medium',
							priority: 'medium',
							rationale: '',
						},
					}),
					status: 'cancelled',
					error: t('linear:validationCancelled'),
				});
				useLinearStore.getState().clearValidationProgress(ticketId);
				onOpenChange(false);
			} else {
				if (result.error?.includes('No active validation')) {
					onOpenChange(false);
				} else {
					setError(result.error || t('linear:cancelFailed'));
				}
			}
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : t('linear:cancelFailed');
			setError(errorMessage);
		}
	}, [ticketId, validation, onOpenChange, t]);

	// Get status message for header
	const getStatusMessage = () => {
		if (validationProgress?.phase) {
			return t(`linear:progressPhases.${validationProgress.phase}`, {
				defaultValue: validationProgress.message || t('linear:validationInProgress'),
				ticketId,
			});
		}

		if (validation?.status === 'validating') {
			return t('linear:validationInProgress');
		}

		if (validation?.status === 'complete') {
			return t('linear:validationComplete');
		}

		return t('linear:analysisInProgress');
	};

	// Render validation step with icon
	const renderStep = (step: ValidationStep) => {
		const { id, label, status } = step;

		return (
			<div
				key={id}
				className={cn(
					'flex items-center gap-3 py-2',
					status === 'error' && 'text-destructive',
				)}
			>
				<div
					className={cn(
						'flex-shrink-0',
						status === 'complete' && 'text-success',
						status === 'in_progress' && 'text-primary animate-pulse',
						status === 'error' && 'text-destructive',
						status === 'pending' && 'text-muted-foreground',
					)}
				>
					{status === 'complete' ? (
						<CheckCircle2 className="h-5 w-5" />
					) : status === 'in_progress' ? (
						<Loader2 className="h-5 w-5 animate-spin" />
					) : status === 'error' ? (
						<AlertCircle className="h-5 w-5" />
					) : (
						<Circle className="h-5 w-5" />
					)}
				</div>
				<span
					className={cn(
						'text-sm',
						status === 'complete' && 'text-foreground',
						status === 'in_progress' && 'text-foreground font-medium',
						status === 'error' && 'text-destructive',
						status === 'pending' && 'text-muted-foreground',
					)}
				>
					{label}
				</span>
			</div>
		);
	};

	// Summary Tab Content
	const renderSummaryTab = () => (
		<ScrollArea className="h-full">
			<div className="p-6 space-y-6">
				{/* Validation Error Display */}
				{validation?.status === 'error' && (
					<Card className="border-destructive bg-destructive/5">
						<CardContent className="pt-6">
							<div className="flex items-start gap-3">
								<AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
								<div className="flex-1 space-y-1">
									<h4 className="text-sm font-semibold text-destructive">
										{t('linear:validationFailed', {
											defaultValue: 'Validation Failed',
										})}
									</h4>
									<p className="text-sm text-destructive/80">
										{validation?.error ||
											t('linear:validationFailedDesc', {
												defaultValue:
													'Failed to validate the ticket. Please try again.',
											})}
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Initial loading indicator */}
				{isInitialLoad && !validation && (
					<div className="flex flex-col items-center justify-center py-12">
						<Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
						<p className="text-sm text-muted-foreground">
							{t('linear:startingValidation', {
								defaultValue: 'Starting validation...',
							})}
						</p>
					</div>
				)}

				{/* Completion Status Card */}
				{validation?.completenessValidation && (
					<Card>
						<CardHeader>
							<CardTitle className="text-base font-semibold flex items-center gap-2">
								<CheckCircle2 className="h-4 w-4" />
								{t('linear:completenessValidation', {
									defaultValue: 'Completeness Validation',
								})}
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="flex items-center gap-2">
								<Badge
									variant={
										validation.completenessValidation.isComplete
											? 'success'
											: 'destructive'
									}
								>
									{validation.completenessValidation.isComplete
										? t('linear:complete', {
												defaultValue: 'Complete',
											})
										: t('linear:incomplete', {
												defaultValue: 'Incomplete',
											})}
								</Badge>
								<span className="text-sm text-muted-foreground">
									{t('linear:feasibilityScore', {
										defaultValue: 'Feasibility',
									})}
									: {validation.completenessValidation.feasibilityScore}%
								</span>
							</div>
							{validation.completenessValidation.missingFields?.length > 0 && (
								<div>
									<span className="text-sm font-medium">
										{t('linear:missingFields', {
											defaultValue: 'Missing Fields',
										})}
										:{' '}
									</span>
									<span className="text-sm text-muted-foreground">
										{validation.completenessValidation.missingFields.join(', ')}
									</span>
								</div>
							)}
						</CardContent>
					</Card>
				)}

				{/* Quick Properties Summary */}
				{validation?.taskProperties && (
					<Card>
						<CardHeader>
							<CardTitle className="text-base font-semibold flex items-center gap-2">
								<Target className="h-4 w-4" />
								{t('linear:taskProperties', {
									defaultValue: 'Task Properties',
								})}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="grid grid-cols-2 gap-3 text-sm">
								<div>
									<span className="text-muted-foreground">
										{t('tasks:form.category', { defaultValue: 'Category' })}:{' '}
									</span>
									<Badge variant="outline">{editState.editedCategory}</Badge>
								</div>
								<div>
									<span className="text-muted-foreground">
										{t('tasks:form.complexity', { defaultValue: 'Complexity' })}:{' '}
									</span>
									<Badge variant="outline">{editState.editedComplexity}</Badge>
								</div>
								<div>
									<span className="text-muted-foreground">
										{t('tasks:form.impact', { defaultValue: 'Impact' })}:{' '}
									</span>
									<Badge variant="outline">{editState.editedImpact}</Badge>
								</div>
								<div>
									<span className="text-muted-foreground">
										{t('tasks:form.priority', { defaultValue: 'Priority' })}:{' '}
									</span>
									<Badge variant="outline">{editState.editedPriority}</Badge>
								</div>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Labels Summary */}
				{editState.editedLabels.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle className="text-base font-semibold flex items-center gap-2">
								<Tag className="h-4 w-4" />
								{t('linear:labels', { defaultValue: 'Labels' })}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-wrap gap-2">
								{editState.editedLabels.map((label, index) => (
									<Badge key={index} variant="secondary" className="text-sm">
										{label.name}
										<span className="ml-1 text-xs text-muted-foreground">
											({Math.round(label.confidence)}%)
										</span>
									</Badge>
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{/* Version Summary */}
				{editState.editedVersion && (
					<Card>
						<CardHeader>
							<CardTitle className="text-base font-semibold flex items-center gap-2">
								<TrendingUp className="h-4 w-4" />
								{t('linear:validationSteps.version', {
									defaultValue: 'Version',
								})}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-sm">
								<span className="font-medium">
									{t('linear:recommendedVersion', {
										defaultValue: 'Recommended Version',
									})}
									:{' '}
								</span>
								<Badge variant="outline">{editState.editedVersion}</Badge>
							</div>
						</CardContent>
					</Card>
				)}
			</div>
		</ScrollArea>
	);

	// Analysis Tab Content
	const renderAnalysisTab = () => (
		<ScrollArea className="h-full">
			<div className="p-6 space-y-6">
				{/* Content Analysis */}
				{validation?.contentAnalysis && (
					<Card>
						<CardHeader>
							<CardTitle className="text-base font-semibold flex items-center gap-2">
								<FileText className="h-4 w-4" />
								{t('linear:contentAnalysis', {
									defaultValue: 'Content Analysis',
								})}
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<div>
								<span className="text-sm font-medium">
									{validation.contentAnalysis.title}
								</span>
							</div>
							<p className="text-sm text-muted-foreground">
								{validation.contentAnalysis.descriptionSummary}
							</p>
							{validation.contentAnalysis.requirements?.length > 0 && (
								<>
									<Separator />
									<div>
										<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
											Requirements
										</p>
										<ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
											{validation.contentAnalysis.requirements.map(
												(req, index) => (
													<li key={index}>{req}</li>
												),
											)}
										</ul>
									</div>
								</>
							)}
						</CardContent>
					</Card>
				)}

				{/* Codebase Verification */}
				{validation?.codebaseVerification &&
					validation.codebaseVerification.searchedFiles?.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-base font-semibold flex items-center gap-2">
									<Search className="h-4 w-4" />
									{t('linear:codebaseVerification', {
										defaultValue: 'Codebase Verification',
									})}
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								{/* Searched Files */}
								<div>
									<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
										{t('linear:filesExamined', {
											defaultValue: 'Files Examined',
										})}
									</p>
									<div className="flex flex-wrap gap-1">
										{validation.codebaseVerification.searchedFiles.map(
											(file, index) => (
												<Badge
													key={index}
													variant="outline"
													className="text-xs font-mono"
												>
													{file}
												</Badge>
											),
										)}
									</div>
								</div>

								{/* Related Implementations */}
								{validation.codebaseVerification.relatedImplementations?.length > 0 && (
									<>
										<Separator />
										<div>
											<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
												{t('linear:relatedCode', {
													defaultValue: 'Related Code Found',
												})}
											</p>
											<div className="space-y-2">
												{validation.codebaseVerification.relatedImplementations.map(
													(impl, index) => (
														<div
															key={index}
															className="p-3 rounded-lg bg-secondary"
														>
															<div className="flex items-center gap-2 mb-1">
																<span className="text-sm font-mono">
																	{impl.file}
																</span>
																<Badge
																	variant={
																		impl.relevance === 'duplicate'
																			? 'destructive'
																			: impl.relevance === 'similar'
																				? 'default'
																				: 'secondary'
																	}
																	className="text-[10px]"
																>
																	{impl.relevance}
																</Badge>
															</div>
															<p className="text-xs text-muted-foreground">
																{impl.description}
															</p>
														</div>
													),
												)}
											</div>
										</div>
									</>
								)}

								{/* Technical Constraints */}
								{validation.codebaseVerification.technicalConstraints?.length > 0 && (
									<>
										<Separator />
										<div>
											<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
												{t('linear:constraints', {
													defaultValue: 'Technical Constraints',
												})}
											</p>
											<p className="text-sm text-muted-foreground">
												{validation.codebaseVerification.technicalConstraints.join(', ')}
											</p>
										</div>
									</>
								)}

								{/* Existing Solutions */}
								{validation.codebaseVerification.existingSolutions && (
									<>
										<Separator />
										<div>
											<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
												{t('linear:existingSolutions', {
													defaultValue: 'Existing Solutions',
												})}
											</p>
											<p className="text-sm text-muted-foreground">
												{validation.codebaseVerification.existingSolutions}
											</p>
										</div>
									</>
								)}
							</CardContent>
						</Card>
					)}

				{/* No Content Available Message */}
				{validation?.status === 'complete' &&
					!validation?.contentAnalysis &&
					!validation?.codebaseVerification &&
					!validation?.completenessValidation && (
						<Card>
							<CardContent className="pt-6">
								<div className="flex flex-col items-center justify-center text-center py-8">
									<AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
									<p className="text-sm text-muted-foreground">
										{t('linear:validationIncomplete', {
											defaultValue:
												'Validation completed but no results were returned. This may indicate an issue with the AI response. Please try again.',
										})}
									</p>
								</div>
							</CardContent>
						</Card>
					)}
			</div>
		</ScrollArea>
	);

	// Recommendations Tab Content
	const renderRecommendationsTab = () => (
		<ScrollArea className="h-full">
			<div className="p-6 space-y-6">
				{/* Labels Section with Edit */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle className="text-base font-semibold flex items-center gap-2">
								<Tag className="h-4 w-4" />
								{t('linear:labels', { defaultValue: 'Labels' })}
							</CardTitle>
							{!editState.editingLabels && editState.editedLabels.length > 0 && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => editState.setEditingLabels(true)}
								>
									<Edit2 className="h-3 w-3 mr-1" />
									{t('linear:actions.edit', { defaultValue: 'Edit' })}
								</Button>
							)}
						</div>
					</CardHeader>
					<CardContent>
						{editState.editingLabels ? (
							<div className="space-y-2">
								{editState.editedLabels.map((label, index) => (
									<div key={index} className="flex items-center gap-2">
										<Input
											value={label.name}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
												const newLabels = [...editState.editedLabels];
												newLabels[index] = {
													...label,
													name: e.target.value,
												};
												editState.setEditedLabels(newLabels);
											}}
											className="flex-1"
										/>
										<Badge variant="outline" className="text-xs shrink-0">
											{Math.round(label.confidence)}%
										</Badge>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => {
												const newLabels = editState.editedLabels.filter(
													(_, i) => i !== index,
												);
												editState.setEditedLabels(newLabels);
											}}
										>
											<X className="h-3 w-3" />
										</Button>
									</div>
								))}
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											editState.setEditedLabels([
												...editState.editedLabels,
												{ name: '', confidence: 0, reason: '' },
											]);
										}}
									>
										{t('linear:actions.add', { defaultValue: 'Add' })}
									</Button>
									<Button
										variant="default"
										size="sm"
										onClick={() => editState.setEditingLabels(false)}
									>
										<Save className="h-3 w-3 mr-1" />
										{t('linear:actions.save', { defaultValue: 'Save' })}
									</Button>
								</div>
							</div>
						) : (
							<div className="flex flex-wrap gap-2">
								{editState.editedLabels.map((label, index) => (
									<Badge key={index} variant="secondary" className="text-sm">
										{label.name}
										<span className="ml-1 text-xs text-muted-foreground">
											({Math.round(label.confidence)}%)
										</span>
									</Badge>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Version Section with Edit */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle className="text-base font-semibold flex items-center gap-2">
								<TrendingUp className="h-4 w-4" />
								{t('linear:validationSteps.version', {
									defaultValue: 'Version',
								})}
							</CardTitle>
							{!editState.editingVersion && editState.editedVersion && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => editState.setEditingVersion(true)}
								>
									<Edit2 className="h-3 w-3 mr-1" />
									{t('linear:actions.edit', { defaultValue: 'Edit' })}
								</Button>
							)}
						</div>
					</CardHeader>
					<CardContent>
						{editState.editingVersion ? (
							<div className="flex gap-2">
								<Input
									value={editState.editedVersion}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
										editState.setEditedVersion(e.target.value)
									}
									placeholder="e.g., v1.2.3"
									className="flex-1"
								/>
								<Button
									variant="default"
									size="sm"
									onClick={() => editState.setEditingVersion(false)}
								>
									<Save className="h-3 w-3 mr-1" />
									{t('linear:actions.save', { defaultValue: 'Save' })}
								</Button>
							</div>
						) : (
							<div className="space-y-2">
								<div className="text-sm">
									<span className="font-medium">
										{t('linear:recommendedVersion', {
											defaultValue: 'Recommended Version',
										})}
										:{' '}
									</span>
									<Badge variant="outline">{editState.editedVersion}</Badge>
								</div>
								{validation?.versionRecommendation && (
									<p className="text-xs text-muted-foreground">
										{validation.versionRecommendation.reasoning}
									</p>
								)}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Task Properties Section with Edit */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle className="text-base font-semibold flex items-center gap-2">
								<Target className="h-4 w-4" />
								{t('linear:taskProperties', {
									defaultValue: 'Task Properties',
								})}
							</CardTitle>
							{!editState.editingProperties && validation?.taskProperties && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => editState.setEditingProperties(true)}
								>
									<Edit2 className="h-3 w-3 mr-1" />
									{t('linear:actions.edit', { defaultValue: 'Edit' })}
								</Button>
							)}
						</div>
					</CardHeader>
					<CardContent>
						{editState.editingProperties ? (
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1">
									<Label className="text-xs">
										{t('tasks:form.category', { defaultValue: 'Category' })}
									</Label>
									<select
										value={editState.editedCategory}
										onChange={(e) =>
											editState.setEditedCategory(e.target.value as TaskCategory)
										}
										className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
									>
										<option value="feature">
											{t('tasks:categories.feature', { defaultValue: 'Feature' })}
										</option>
										<option value="bug_fix">
											{t('tasks:categories.bug_fix', { defaultValue: 'Bug Fix' })}
										</option>
										<option value="refactoring">
											{t('tasks:categories.refactoring', {
												defaultValue: 'Refactoring',
											})}
										</option>
										<option value="documentation">
											{t('tasks:categories.documentation', {
												defaultValue: 'Documentation',
											})}
										</option>
										<option value="security">
											{t('tasks:categories.security', { defaultValue: 'Security' })}
										</option>
									</select>
								</div>
								<div className="space-y-1">
									<Label className="text-xs">
										{t('tasks:form.complexity', { defaultValue: 'Complexity' })}
									</Label>
									<select
										value={editState.editedComplexity}
										onChange={(e) =>
											editState.setEditedComplexity(e.target.value as TaskComplexity)
										}
										className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
									>
										<option value="trivial">
											{t('tasks:complexities.trivial', { defaultValue: 'Trivial' })}
										</option>
										<option value="small">
											{t('tasks:complexities.small', { defaultValue: 'Small' })}
										</option>
										<option value="medium">
											{t('tasks:complexities.medium', { defaultValue: 'Medium' })}
										</option>
										<option value="large">
											{t('tasks:complexities.large', { defaultValue: 'Large' })}
										</option>
										<option value="complex">
											{t('tasks:complexities.complex', { defaultValue: 'Complex' })}
										</option>
									</select>
								</div>
								<div className="space-y-1">
									<Label className="text-xs">
										{t('tasks:form.impact', { defaultValue: 'Impact' })}
									</Label>
									<select
										value={editState.editedImpact}
										onChange={(e) =>
											editState.setEditedImpact(e.target.value as TaskImpact)
										}
										className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
									>
										<option value="low">
											{t('tasks:impacts.low', { defaultValue: 'Low' })}
										</option>
										<option value="medium">
											{t('tasks:impacts.medium', { defaultValue: 'Medium' })}
										</option>
										<option value="high">
											{t('tasks:impacts.high', { defaultValue: 'High' })}
										</option>
										<option value="critical">
											{t('tasks:impacts.critical', { defaultValue: 'Critical' })}
										</option>
									</select>
								</div>
								<div className="space-y-1">
									<Label className="text-xs">
										{t('tasks:form.priority', { defaultValue: 'Priority' })}
									</Label>
									<select
										value={editState.editedPriority}
										onChange={(e) =>
											editState.setEditedPriority(e.target.value as TaskPriority)
										}
										className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
									>
										<option value="low">
											{t('tasks:priorities.low', { defaultValue: 'Low' })}
										</option>
										<option value="medium">
											{t('tasks:priorities.medium', { defaultValue: 'Medium' })}
										</option>
										<option value="high">
											{t('tasks:priorities.high', { defaultValue: 'High' })}
										</option>
										<option value="urgent">
											{t('tasks:priorities.urgent', { defaultValue: 'Urgent' })}
										</option>
									</select>
								</div>
								<div className="col-span-2 flex justify-end">
									<Button
										variant="default"
										size="sm"
										onClick={() => editState.setEditingProperties(false)}
									>
										<Save className="h-3 w-3 mr-1" />
										{t('linear:actions.save', { defaultValue: 'Save' })}
									</Button>
								</div>
							</div>
						) : (
							<div className="grid grid-cols-2 gap-3 text-sm">
								<div>
									<span className="text-muted-foreground">
										{t('tasks:form.category', { defaultValue: 'Category' })}:{' '}
									</span>
									<Badge variant="outline">{editState.editedCategory}</Badge>
								</div>
								<div>
									<span className="text-muted-foreground">
										{t('tasks:form.complexity', { defaultValue: 'Complexity' })}:{' '}
									</span>
									<Badge variant="outline">{editState.editedComplexity}</Badge>
								</div>
								<div>
									<span className="text-muted-foreground">
										{t('tasks:form.impact', { defaultValue: 'Impact' })}:{' '}
									</span>
									<Badge variant="outline">{editState.editedImpact}</Badge>
								</div>
								<div>
									<span className="text-muted-foreground">
										{t('tasks:form.priority', { defaultValue: 'Priority' })}:{' '}
									</span>
									<Badge variant="outline">{editState.editedPriority}</Badge>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</ScrollArea>
	);

	// Completeness Tab Content
	const renderCompletenessTab = () => (
		<ScrollArea className="h-full">
			<div className="p-6 space-y-6">
				{validation?.completenessValidation ? (
					<Card>
						<CardHeader>
							<CardTitle className="text-base font-semibold flex items-center gap-2">
								<CheckCircle2 className="h-4 w-4" />
								{t('linear:completenessValidation', {
									defaultValue: 'Completeness Validation',
								})}
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center gap-2">
								<Badge
									variant={
										validation.completenessValidation.isComplete
											? 'success'
											: 'destructive'
									}
								>
									{validation.completenessValidation.isComplete
										? t('linear:complete', {
												defaultValue: 'Complete',
											})
										: t('linear:incomplete', {
												defaultValue: 'Incomplete',
											})}
								</Badge>
								<span className="text-sm text-muted-foreground">
									{t('linear:feasibilityScore', {
										defaultValue: 'Feasibility',
									})}
									: {validation.completenessValidation.feasibilityScore}%
								</span>
							</div>
							{validation.completenessValidation.missingFields?.length > 0 && (
								<div className="space-y-2">
									<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
										{t('linear:missingFields', {
											defaultValue: 'Missing Fields',
										})}
									</p>
									<div className="flex flex-wrap gap-2">
										{validation.completenessValidation.missingFields.map(
											(field, index) => (
												<Badge key={index} variant="outline">
													{field}
												</Badge>
											),
										)}
									</div>
								</div>
							)}
							<Separator />
							<div>
								<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
									Feasibility Reasoning
								</p>
								<p className="text-sm text-muted-foreground">
									{validation.completenessValidation.feasibilityReasoning}
								</p>
							</div>
						</CardContent>
					</Card>
				) : (
					<Card>
						<CardContent className="pt-6">
							<div className="flex flex-col items-center justify-center py-8 text-center">
								<CheckCircle2 className="h-12 w-12 text-muted-foreground mb-4" />
								<p className="text-sm text-muted-foreground">
									Completeness validation not available yet.
								</p>
							</div>
						</CardContent>
					</Card>
				)}
			</div>
		</ScrollArea>
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Target className="h-5 w-5" />
						{t('linear:validation', { defaultValue: 'Validation' })}
					</DialogTitle>
					<DialogDescription>
						{getStatusMessage()}
						{validationProgress && (
							<span className="ml-2 text-muted-foreground">
								({Math.round((validationProgress.step / validationProgress.total) * 100)}%)
							</span>
						)}
					</DialogDescription>
				</DialogHeader>

				{/* Progress Bar */}
				{validationProgress && (
					<div className="space-y-1">
						<Progress
							value={
								validationProgress.total > 0
									? (validationProgress.step / validationProgress.total) * 100
									: 0
							}
							className="h-2"
						/>
						<div className="flex justify-between text-xs text-muted-foreground">
							<span>{t('linear:progress', { defaultValue: 'Progress' })}</span>
							<span>
								{validationProgress.step} / {validationProgress.total}
							</span>
						</div>
					</div>
				)}

				{/* Tabs */}
				<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 min-h-0 overflow-hidden">
					<TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-0 h-auto shrink-0">
						<TabsTrigger
							value="summary"
							className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm"
						>
							Summary
						</TabsTrigger>
						<TabsTrigger
							value="analysis"
							className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm"
						>
							Analysis
						</TabsTrigger>
						<TabsTrigger
							value="recommendations"
							className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm"
						>
							Recommendations
						</TabsTrigger>
						<TabsTrigger
							value="completeness"
							className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm"
						>
							Completeness
						</TabsTrigger>
					</TabsList>

					<TabsContent value="summary" className="flex-1 min-h-0 overflow-hidden mt-0">
						{renderSummaryTab()}
					</TabsContent>

					<TabsContent value="analysis" className="flex-1 min-h-0 overflow-hidden mt-0">
						{renderAnalysisTab()}
					</TabsContent>

					<TabsContent value="recommendations" className="flex-1 min-h-0 overflow-hidden mt-0">
						{renderRecommendationsTab()}
					</TabsContent>

					<TabsContent value="completeness" className="flex-1 min-h-0 overflow-hidden mt-0">
						{renderCompletenessTab()}
					</TabsContent>
				</Tabs>

				{/* Validation Steps (always visible at bottom) */}
				<div className="border-t border-border pt-4">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
						{t('linear:validationStatus', {
							defaultValue: 'Validation Status',
						})}
					</p>
					<div className="grid grid-cols-2 gap-x-6 gap-y-1">
						{validationSteps.map(renderStep)}
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => {
							if (validation?.status === 'validating' || isInitialLoad) {
								handleCancel();
							} else {
								onOpenChange(false);
							}
						}}
						disabled={isCreating}
					>
						{validation?.status === 'validating' || isInitialLoad
							? t('linear:cancel', { defaultValue: 'Cancel' })
							: t('common:close', { defaultValue: 'Close' })}
					</Button>

					{(validation?.status === 'validating' || isInitialLoad) && (
						<Button disabled>
							<Loader2 className="h-4 w-4 mr-2 animate-spin" />
							{t('linear:validating', { defaultValue: 'Validating...' })}
						</Button>
					)}

					{validation?.status === 'complete' && (
						<Button onClick={handleCreateTask} disabled={isCreating}>
							{isCreating ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									{t('linear:creating', { defaultValue: 'Creating...' })}
								</>
							) : (
								<>
									<Target className="h-4 w-4 mr-2" />
									{t('linear:createTask', {
										defaultValue: 'Create Task',
									})}
								</>
							)}
						</Button>
					)}
				</DialogFooter>

				{/* Error Display */}
				{error && (
					<div className="absolute bottom-20 left-6 right-6">
						<div className="p-3 bg-destructive/10 border border-destructive rounded-lg text-sm text-destructive">
							{error}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
