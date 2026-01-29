import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
	CheckCircle2,
	AlertCircle,
	ExternalLink,
	Tag,
	Target,
	TrendingUp,
	Loader2,
} from 'lucide-react';
import type { LinearTicket, ValidationResult } from '@shared/types';
import { createTaskFromLinearTicket } from '../../../stores/linear-store';
import { cn } from '../../../lib/utils';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '../../ui/dialog';
import { Card, CardContent } from '../../ui/card';

interface ValidationResultsProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	ticket: LinearTicket;
	validation: ValidationResult;
}

/**
 * Simplified validation results modal.
 * Shows ticket info, validation status, labels, properties, version, and Create Task button.
 * No editing - keep it simple. Users can edit the task after creation.
 */
export function ValidationResults({
	open,
	onOpenChange,
	ticket,
	validation,
}: ValidationResultsProps) {
	const { t } = useTranslation(['linear', 'common', 'tasks']);
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Handle create task
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

	const isComplete = validation.completenessValidation?.isComplete ?? false;
	const feasibilityScore = validation.completenessValidation?.feasibilityScore ?? 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<CheckCircle2 className="h-5 w-5 text-success" />
						{t('linear:validationComplete', { defaultValue: 'Validation Complete' })}
					</DialogTitle>
					<DialogDescription>
						{ticket.identifier} · {isComplete ? t('linear:complete') : t('linear:incomplete')} · {feasibilityScore}% {t('linear:feasibilityScore')}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Ticket Info */}
					<Card>
						<CardContent className="pt-4">
							<div className="flex items-start justify-between gap-2">
								<div className="flex-1 min-w-0">
									<h3 className="font-semibold truncate">{ticket.title}</h3>
									<p className="text-sm text-muted-foreground">{ticket.identifier}</p>
								</div>
								<a
									href={ticket.url}
									target="_blank"
									rel="noopener noreferrer"
									className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
									aria-label={t('linear:viewOnLinear')}
								>
									<ExternalLink className="h-4 w-4" />
								</a>
							</div>
						</CardContent>
					</Card>

					{/* Validation Status Badge */}
					<div className="flex items-center gap-2">
						<Badge
							variant={isComplete ? 'success' : 'destructive'}
							className="text-sm"
						>
							{isComplete ? (
								<>
									<CheckCircle2 className="h-3 w-3 mr-1" />
									{t('linear:complete')}
								</>
							) : (
								<>
									<AlertCircle className="h-3 w-3 mr-1" />
									{t('linear:incomplete')}
								</>
							)}
						</Badge>
						<span className="text-sm text-muted-foreground">
							{t('linear:feasibilityScore')}: {feasibilityScore}%
						</span>
					</div>

					{/* Description Summary */}
					{validation.contentAnalysis?.descriptionSummary && (
						<Card>
							<CardContent className="pt-4">
								<p className="text-sm text-muted-foreground">
									{validation.contentAnalysis.descriptionSummary}
								</p>
							</CardContent>
						</Card>
					)}

					{/* Labels */}
					{validation.suggestedLabels && validation.suggestedLabels.length > 0 && (
						<Card>
							<CardContent className="pt-4">
								<div className="flex items-center gap-2 mb-2">
									<Tag className="h-4 w-4 text-muted-foreground" />
									<h4 className="text-sm font-medium">{t('linear:labels')}</h4>
								</div>
								<div className="flex flex-wrap gap-2">
									{validation.suggestedLabels.map((label, index) => (
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

					{/* Task Properties */}
					{validation.taskProperties && (
						<Card>
							<CardContent className="pt-4">
								<div className="flex items-center gap-2 mb-2">
									<Target className="h-4 w-4 text-muted-foreground" />
									<h4 className="text-sm font-medium">{t('linear:taskProperties')}</h4>
								</div>
								<div className="grid grid-cols-2 gap-2 text-sm">
									<div>
										<span className="text-muted-foreground">{t('tasks:form.category')}:</span>{' '}
										<Badge variant="outline">{validation.taskProperties.category}</Badge>
									</div>
									<div>
										<span className="text-muted-foreground">{t('tasks:form.complexity')}:</span>{' '}
										<Badge variant="outline">{validation.taskProperties.complexity}</Badge>
									</div>
									<div>
										<span className="text-muted-foreground">{t('tasks:form.impact')}:</span>{' '}
										<Badge variant="outline">{validation.taskProperties.impact}</Badge>
									</div>
									<div>
										<span className="text-muted-foreground">{t('tasks:form.priority')}:</span>{' '}
										<Badge variant="outline">{validation.taskProperties.priority}</Badge>
									</div>
								</div>
							</CardContent>
						</Card>
					)}

					{/* Version */}
					{validation.versionRecommendation?.recommendedVersion && (
						<Card>
							<CardContent className="pt-4">
								<div className="flex items-center gap-2 mb-2">
									<TrendingUp className="h-4 w-4 text-muted-foreground" />
									<h4 className="text-sm font-medium">{t('linear:recommendedVersion')}</h4>
								</div>
								<div className="flex items-center gap-2">
									<Badge variant="outline" className="text-sm">
										{validation.versionRecommendation.recommendedVersion}
									</Badge>
									<Badge
										variant="secondary"
										className={cn(
											'text-xs',
											validation.versionRecommendation.versionType === 'major' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
											validation.versionRecommendation.versionType === 'minor' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
											validation.versionRecommendation.versionType === 'patch' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
										)}
									>
										{validation.versionRecommendation.versionType}
									</Badge>
								</div>
							</CardContent>
						</Card>
					)}

					{/* Missing Fields Warning */}
					{!isComplete && validation.completenessValidation?.missingFields && validation.completenessValidation.missingFields.length > 0 && (
						<Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
							<CardContent className="pt-4">
								<div className="flex items-start gap-2">
									<AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
									<div className="flex-1">
										<p className="text-sm font-medium text-amber-900 dark:text-amber-100">
											{t('linear:missingFields', { defaultValue: 'Missing Fields' })}
										</p>
										<div className="flex flex-wrap gap-1 mt-1">
											{validation.completenessValidation.missingFields.map((field, index) => (
												<Badge key={index} variant="outline" className="text-xs">
													{field}
												</Badge>
											))}
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
						{t('common:close')}
					</Button>
					<Button onClick={handleCreateTask} disabled={isCreating}>
						{isCreating ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								{t('linear:creating')}
							</>
						) : (
							<>
								<Target className="h-4 w-4 mr-2" />
								{t('linear:createTask')}
							</>
						)}
					</Button>
				</DialogFooter>

				{/* Error Display */}
				{error && (
					<div className="p-3 bg-destructive/10 border border-destructive rounded-lg text-sm text-destructive">
						{error}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
