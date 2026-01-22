/**
 * ValidationModal - Modal for displaying AI-powered ticket validation results
 *
 * Features:
 * - Streaming progress display for 5-step validation workflow
 * - Editable validation results (labels, version, task properties)
 * - Create Task button integration with Kanban board
 * - Follows Radix UI Dialog pattern
 */

import {
	AlertCircle,
	CheckCircle2,
	Circle,
	Edit2,
	FileText,
	Loader2,
	Save,
	Settings,
	Tag,
	Target,
	TrendingUp,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	TaskCategory,
	TaskComplexity,
	TaskImpact,
	TaskPriority,
	ValidationResult,
} from "../../../../shared/types";
import { cn } from "../../../lib/utils";
import { createTaskFromLinearTicket } from "../../../stores/linear-store";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";

interface ValidationModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	ticketId: string;
	validation: ValidationResult | null;
}

type ValidationStep = {
	id: string;
	label: string;
	status: "pending" | "in_progress" | "complete" | "error";
	icon: typeof CheckCircle2;
};

/**
 * ValidationModal component displays AI validation results with streaming progress
 */
export function ValidationModal({
	open,
	onOpenChange,
	ticketId,
	validation,
}: ValidationModalProps) {
	const { t } = useTranslation(["common", "tasks"]);

	// Edit mode state for each section
	const [editingLabels, setEditingLabels] = useState(false);
	const [editingVersion, setEditingVersion] = useState(false);
	const [editingProperties, setEditingProperties] = useState(false);

	// Editable values
	const [editedLabels, setEditedLabels] = useState<
		Array<{ name: string; confidence: number; reason: string }>
	>([]);
	const [editedVersion, setEditedVersion] = useState("");
	const [editedCategory, setEditedCategory] = useState<TaskCategory>("feature");
	const [editedComplexity, setEditedComplexity] =
		useState<TaskComplexity>("medium");
	const [editedImpact, setEditedImpact] = useState<TaskImpact>("medium");
	const [editedPriority, setEditedPriority] = useState<TaskPriority>("medium");

	// UI state
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Initialize editable values when validation changes
	useEffect(() => {
		if (validation) {
			setEditedLabels(validation.suggestedLabels || []);
			setEditedVersion(
				validation.versionRecommendation?.recommendedVersion || "",
			);
			setEditedCategory(validation.taskProperties?.category || "feature");
			setEditedComplexity(validation.taskProperties?.complexity || "medium");
			setEditedImpact(validation.taskProperties?.impact || "medium");
			setEditedPriority(validation.taskProperties?.priority || "medium");
		}
	}, [validation]);

	// Compute validation steps based on validation status
	const validationSteps: ValidationStep[] = [
		{
			id: "analyze",
			label: t("common:linear.validationSteps.analyze", {
				defaultValue: "Analyze Content",
			}),
			status: validation?.contentAnalysis
				? "complete"
				: validation?.status === "validating"
					? "in_progress"
					: "pending",
			icon: FileText,
		},
		{
			id: "completeness",
			label: t("common:linear.validationSteps.completeness", {
				defaultValue: "Validate Completeness",
			}),
			status: validation?.completenessValidation
				? "complete"
				: validation?.status === "validating"
					? "in_progress"
					: "pending",
			icon: CheckCircle2,
		},
		{
			id: "labels",
			label: t("common:linear.validationSteps.labels", {
				defaultValue: "Auto-Select Labels",
			}),
			status: validation?.suggestedLabels?.length
				? "complete"
				: validation?.status === "validating"
					? "in_progress"
					: "pending",
			icon: Tag,
		},
		{
			id: "version",
			label: t("common:linear.validationSteps.version", {
				defaultValue: "Determine Version",
			}),
			status: validation?.versionRecommendation
				? "complete"
				: validation?.status === "validating"
					? "in_progress"
					: "pending",
			icon: TrendingUp,
		},
		{
			id: "properties",
			label: t("common:linear.validationSteps.properties", {
				defaultValue: "Recommend Properties",
			}),
			status: validation?.taskProperties
				? "complete"
				: validation?.status === "validating"
					? "in_progress"
					: "pending",
			icon: Settings,
		},
	];

	// Handle create task
	const handleCreateTask = useCallback(async () => {
		if (!validation) return;

		setIsCreating(true);
		setError(null);

		try {
			// Build updated validation result with edited values
			const updatedValidation: ValidationResult = {
				...validation,
				suggestedLabels: editedLabels,
				versionRecommendation: {
					...(validation.versionRecommendation || {}),
					recommendedVersion: editedVersion,
				},
				taskProperties: {
					...(validation.taskProperties || {}),
					category: editedCategory,
					complexity: editedComplexity,
					impact: editedImpact,
					priority: editedPriority,
				},
			};

			await createTaskFromLinearTicket(ticketId, updatedValidation);
			onOpenChange(false);
		} catch (err) {
			const errorMessage =
				err instanceof Error
					? err.message
					: t("common:linear.createTaskFailed", {
							defaultValue: "Failed to create task",
						});
			setError(errorMessage);
		} finally {
			setIsCreating(false);
		}
	}, [
		validation,
		editedLabels,
		editedVersion,
		editedCategory,
		editedComplexity,
		editedImpact,
		editedPriority,
		ticketId,
		onOpenChange,
		t,
	]);

	// Render validation step with icon
	const renderStep = (step: ValidationStep) => {
		const { id, label, status } = step;

		return (
			<div
				key={id}
				className={cn(
					"flex items-center gap-3 py-2",
					status === "error" && "text-destructive",
				)}
			>
				<div
					className={cn(
						"flex-shrink-0",
						status === "complete" && "text-success",
						status === "in_progress" && "text-primary animate-pulse",
						status === "error" && "text-destructive",
						status === "pending" && "text-muted-foreground",
					)}
				>
					{status === "complete" ? (
						<CheckCircle2 className="h-5 w-5" />
					) : status === "in_progress" ? (
						<Loader2 className="h-5 w-5 animate-spin" />
					) : status === "error" ? (
						<AlertCircle className="h-5 w-5" />
					) : (
						<Circle className="h-5 w-5" />
					)}
				</div>
				<span
					className={cn(
						"text-sm",
						status === "complete" && "text-foreground",
						status === "in_progress" && "text-foreground font-medium",
						status === "error" && "text-destructive",
						status === "pending" && "text-muted-foreground",
					)}
				>
					{label}
				</span>
			</div>
		);
	};

	// Render editable labels section
	const renderLabelsSection = () => {
		if (
			!validation?.suggestedLabels?.length &&
			validation?.status !== "validating"
		) {
			return null;
		}

		return (
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<Label className="text-base font-semibold flex items-center gap-2">
						<Tag className="h-4 w-4" />
						{t("common:linear.labels", { defaultValue: "Labels" })}
					</Label>
					{!editingLabels && validation?.suggestedLabels?.length && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setEditingLabels(true)}
						>
							<Edit2 className="h-3 w-3 mr-1" />
							{t("common:actions.edit", { defaultValue: "Edit" })}
						</Button>
					)}
				</div>

				{editingLabels ? (
					<div className="space-y-2">
						{editedLabels.map((label, index) => (
							<div key={index} className="flex items-center gap-2">
								<Input
									value={label.name}
									onChange={(e) => {
										const newLabels = [...editedLabels];
										newLabels[index] = { ...label, name: e.target.value };
										setEditedLabels(newLabels);
									}}
									className="flex-1"
								/>
								<Badge variant="outline" className="text-xs">
									{Math.round(label.confidence)}%
								</Badge>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const newLabels = editedLabels.filter(
											(_, i) => i !== index,
										);
										setEditedLabels(newLabels);
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
									setEditedLabels([
										...editedLabels,
										{ name: "", confidence: 0, reason: "" },
									]);
								}}
							>
								{t("common:actions.add", { defaultValue: "Add" })}
							</Button>
							<Button
								variant="default"
								size="sm"
								onClick={() => setEditingLabels(false)}
							>
								<Save className="h-3 w-3 mr-1" />
								{t("common:actions.save", { defaultValue: "Save" })}
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-wrap gap-2">
						{editedLabels.map((label, index) => (
							<Badge key={index} variant="secondary" className="text-sm">
								{label.name}
								<span className="ml-1 text-xs text-muted-foreground">
									({Math.round(label.confidence)}%)
								</span>
							</Badge>
						))}
					</div>
				)}
			</div>
		);
	};

	// Render version section
	const renderVersionSection = () => {
		if (
			!validation?.versionRecommendation &&
			validation?.status !== "validating"
		) {
			return null;
		}

		return (
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<Label className="text-base font-semibold flex items-center gap-2">
						<TrendingUp className="h-4 w-4" />
						{t("common:linear.validationSteps.version", {
							defaultValue: "Version",
						})}
					</Label>
					{!editingVersion && validation?.versionRecommendation && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setEditingVersion(true)}
						>
							<Edit2 className="h-3 w-3 mr-1" />
							{t("common:actions.edit", { defaultValue: "Edit" })}
						</Button>
					)}
				</div>

				{editingVersion ? (
					<div className="flex gap-2">
						<Input
							value={editedVersion}
							onChange={(e) => setEditedVersion(e.target.value)}
							placeholder={t("tasks:versionPlaceholder")}
							className="flex-1"
						/>
						<Button
							variant="default"
							size="sm"
							onClick={() => setEditingVersion(false)}
						>
							<Save className="h-3 w-3 mr-1" />
							{t("common:actions.save", { defaultValue: "Save" })}
						</Button>
					</div>
				) : (
					<div className="space-y-1">
						<div className="text-sm">
							<span className="font-medium">
								{t("common:linear.recommendedVersion", {
									defaultValue: "Recommended Version",
								})}
								:{" "}
							</span>
							<Badge variant="outline">{editedVersion}</Badge>
						</div>
						{validation?.versionRecommendation && (
							<p className="text-xs text-muted-foreground">
								{validation.versionRecommendation.reasoning}
							</p>
						)}
					</div>
				)}
			</div>
		);
	};

	// Render task properties section
	const renderPropertiesSection = () => {
		if (!validation?.taskProperties && validation?.status !== "validating") {
			return null;
		}

		return (
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<Label className="text-base font-semibold flex items-center gap-2">
						<Target className="h-4 w-4" />
						{t("common:linear.taskProperties", {
							defaultValue: "Task Properties",
						})}
					</Label>
					{!editingProperties && validation?.taskProperties && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setEditingProperties(true)}
						>
							<Edit2 className="h-3 w-3 mr-1" />
							{t("common:actions.edit", { defaultValue: "Edit" })}
						</Button>
					)}
				</div>

				{editingProperties ? (
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<Label className="text-xs">
								{t("tasks:form.category", { defaultValue: "Category" })}
							</Label>
							<select
								value={editedCategory}
								onChange={(e) =>
									setEditedCategory(e.target.value as TaskCategory)
								}
								className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
							>
								<option value="feature">
									{t("tasks:categories.feature", { defaultValue: "Feature" })}
								</option>
								<option value="bug_fix">
									{t("tasks:categories.bug_fix", { defaultValue: "Bug Fix" })}
								</option>
								<option value="refactoring">
									{t("tasks:categories.refactoring", {
										defaultValue: "Refactoring",
									})}
								</option>
								<option value="documentation">
									{t("tasks:categories.documentation", {
										defaultValue: "Documentation",
									})}
								</option>
								<option value="security">
									{t("tasks:categories.security", { defaultValue: "Security" })}
								</option>
							</select>
						</div>
						<div className="space-y-1">
							<Label className="text-xs">
								{t("tasks:form.complexity", { defaultValue: "Complexity" })}
							</Label>
							<select
								value={editedComplexity}
								onChange={(e) =>
									setEditedComplexity(e.target.value as TaskComplexity)
								}
								className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
							>
								<option value="trivial">
									{t("tasks:complexities.trivial", { defaultValue: "Trivial" })}
								</option>
								<option value="small">
									{t("tasks:complexities.small", { defaultValue: "Small" })}
								</option>
								<option value="medium">
									{t("tasks:complexities.medium", { defaultValue: "Medium" })}
								</option>
								<option value="large">
									{t("tasks:complexities.large", { defaultValue: "Large" })}
								</option>
								<option value="complex">
									{t("tasks:complexities.complex", { defaultValue: "Complex" })}
								</option>
							</select>
						</div>
						<div className="space-y-1">
							<Label className="text-xs">
								{t("tasks:form.impact", { defaultValue: "Impact" })}
							</Label>
							<select
								value={editedImpact}
								onChange={(e) => setEditedImpact(e.target.value as TaskImpact)}
								className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
							>
								<option value="low">
									{t("tasks:impacts.low", { defaultValue: "Low" })}
								</option>
								<option value="medium">
									{t("tasks:impacts.medium", { defaultValue: "Medium" })}
								</option>
								<option value="high">
									{t("tasks:impacts.high", { defaultValue: "High" })}
								</option>
								<option value="critical">
									{t("tasks:impacts.critical", { defaultValue: "Critical" })}
								</option>
							</select>
						</div>
						<div className="space-y-1">
							<Label className="text-xs">
								{t("tasks:form.priority", { defaultValue: "Priority" })}
							</Label>
							<select
								value={editedPriority}
								onChange={(e) =>
									setEditedPriority(e.target.value as TaskPriority)
								}
								className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
							>
								<option value="low">
									{t("tasks:priorities.low", { defaultValue: "Low" })}
								</option>
								<option value="medium">
									{t("tasks:priorities.medium", { defaultValue: "Medium" })}
								</option>
								<option value="high">
									{t("tasks:priorities.high", { defaultValue: "High" })}
								</option>
								<option value="urgent">
									{t("tasks:priorities.urgent", { defaultValue: "Urgent" })}
								</option>
							</select>
						</div>
						<div className="col-span-2 flex justify-end">
							<Button
								variant="default"
								size="sm"
								onClick={() => setEditingProperties(false)}
							>
								<Save className="h-3 w-3 mr-1" />
								{t("common:actions.save", { defaultValue: "Save" })}
							</Button>
						</div>
					</div>
				) : (
					<div className="grid grid-cols-2 gap-3 text-sm">
						<div>
							<span className="text-muted-foreground">
								{t("tasks:form.category", { defaultValue: "Category" })}:{" "}
							</span>
							<Badge variant="outline">{editedCategory}</Badge>
						</div>
						<div>
							<span className="text-muted-foreground">
								{t("tasks:form.complexity", { defaultValue: "Complexity" })}:{" "}
							</span>
							<Badge variant="outline">{editedComplexity}</Badge>
						</div>
						<div>
							<span className="text-muted-foreground">
								{t("tasks:form.impact", { defaultValue: "Impact" })}:{" "}
							</span>
							<Badge variant="outline">{editedImpact}</Badge>
						</div>
						<div>
							<span className="text-muted-foreground">
								{t("tasks:form.priority", { defaultValue: "Priority" })}:{" "}
							</span>
							<Badge variant="outline">{editedPriority}</Badge>
						</div>
					</div>
				)}
			</div>
		);
	};

	// Render content
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Target className="h-5 w-5" />
						{t("common:linear.validation", { defaultValue: "Validation" })}
					</DialogTitle>
					<DialogDescription>
						{validation?.status === "validating"
							? t("common:linear.validationInProgress", {
									defaultValue: "AI validation in progress...",
								})
							: validation?.status === "complete"
								? t("common:linear.validationComplete", {
										defaultValue: "Validation complete",
									})
								: t("common:linear.analysisInProgress", {
										defaultValue: "Analyzing ticket...",
									})}
					</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-y-auto space-y-6 py-4">
					{/* Validation Steps */}
					<div className="space-y-2">
						<Label className="text-sm font-medium text-muted-foreground">
							{t("common:linear.validationStatus", {
								defaultValue: "Validation Status",
							})}
						</Label>
						{validationSteps.map(renderStep)}
					</div>

					{/* Content Analysis */}
					{validation?.contentAnalysis && (
						<div className="space-y-2">
							<Label className="text-base font-semibold flex items-center gap-2">
								<FileText className="h-4 w-4" />
								{t("common:linear.contentAnalysis", {
									defaultValue: "Content Analysis",
								})}
							</Label>
							<div className="text-sm space-y-2">
								<div>
									<span className="font-medium">
										{validation.contentAnalysis.title}
									</span>
								</div>
								<p className="text-muted-foreground">
									{validation.contentAnalysis.descriptionSummary}
								</p>
								{validation.contentAnalysis.requirements?.length > 0 && (
									<ul className="list-disc list-inside text-muted-foreground space-y-1">
										{validation.contentAnalysis.requirements.map(
											(req, index) => (
												<li key={index}>{req}</li>
											),
										)}
									</ul>
								)}
							</div>
						</div>
					)}

					{/* Completeness Validation */}
					{validation?.completenessValidation && (
						<div className="space-y-2">
							<Label className="text-base font-semibold flex items-center gap-2">
								<CheckCircle2 className="h-4 w-4" />
								{t("common:linear.completenessValidation", {
									defaultValue: "Completeness Validation",
								})}
							</Label>
							<div className="text-sm space-y-2">
								<div className="flex items-center gap-2">
									<Badge
										variant={
											validation.completenessValidation.isComplete
												? "success"
												: "destructive"
										}
									>
										{validation.completenessValidation.isComplete
											? t("common:linear.complete", {
													defaultValue: "Complete",
												})
											: t("common:linear.incomplete", {
													defaultValue: "Incomplete",
												})}
									</Badge>
									<span className="text-muted-foreground">
										{t("common:linear.feasibilityScore", {
											defaultValue: "Feasibility",
										})}
										: {validation.completenessValidation.feasibilityScore}%
									</span>
								</div>
								{validation.completenessValidation.missingFields?.length >
									0 && (
									<div>
										<span className="font-medium">
											{t("common:linear.missingFields", {
												defaultValue: "Missing Fields",
											})}
											:{" "}
										</span>
										<span className="text-muted-foreground">
											{validation.completenessValidation.missingFields.join(
												", ",
											)}
										</span>
									</div>
								)}
								<p className="text-muted-foreground">
									{validation.completenessValidation.feasibilityReasoning}
								</p>
							</div>
						</div>
					)}

					{/* Labels Section */}
					{renderLabelsSection()}

					{/* Version Section */}
					{renderVersionSection()}

					{/* Task Properties Section */}
					{renderPropertiesSection()}

					{/* Error */}
					{error && (
						<div className="p-3 bg-destructive/10 border border-destructive rounded-lg text-sm text-destructive">
							{error}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isCreating}
					>
						{t("common:linear.cancel", { defaultValue: "Cancel" })}
					</Button>
					{validation?.status === "complete" && (
						<Button onClick={handleCreateTask} disabled={isCreating}>
							{isCreating ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									{t("common:linear.creating", { defaultValue: "Creating..." })}
								</>
							) : (
								<>
									<Target className="h-4 w-4 mr-2" />
									{t("common:linear.createTask", {
										defaultValue: "Create Task",
									})}
								</>
							)}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
