/**
 * SpecEditor — Form for creating or editing a spec/task.
 *
 * Pure prop-driven component with no direct store or i18n dependencies.
 */

import type {
	ModelTypeShort,
	Task,
	TaskCategory,
	TaskComplexity,
	TaskImpact,
	TaskPriority,
} from "@auto-claude/types";
import type * as React from "react";
import { useCallback, useState } from "react";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";
import { Textarea } from "../primitives/textarea";

const CATEGORY_OPTIONS: TaskCategory[] = [
	"feature",
	"bug_fix",
	"refactoring",
	"documentation",
	"security",
	"performance",
	"ui_ux",
	"infrastructure",
	"testing",
];
const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];
const COMPLEXITY_OPTIONS: TaskComplexity[] = [
	"trivial",
	"small",
	"medium",
	"large",
	"complex",
];
const IMPACT_OPTIONS: TaskImpact[] = ["low", "medium", "high", "critical"];

export interface SpecEditorData {
	title: string;
	description: string;
	category?: TaskCategory;
	priority?: TaskPriority;
	complexity?: TaskComplexity;
	impact?: TaskImpact;
	model?: ModelTypeShort;
}

export interface SpecEditorLabels {
	title?: string;
	description?: string;
	category?: string;
	priority?: string;
	complexity?: string;
	impact?: string;
	model?: string;
	cancelButton?: string;
	createButton?: string;
	saveButton?: string;
	savingButton?: string;
}

export interface SpecEditorProps {
	/** Existing spec for editing; undefined for create mode */
	spec?: Task;
	onSave: (data: SpecEditorData) => void;
	onCancel: () => void;
	isLoading?: boolean;
	availableModels?: ModelTypeShort[];
	/** Override default English labels for i18n */
	labels?: SpecEditorLabels;
}

const selectClass =
	"flex h-9 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-200";

function SpecEditor({
	spec,
	onSave,
	onCancel,
	isLoading = false,
	availableModels,
	labels,
}: SpecEditorProps) {
	const [title, setTitle] = useState(spec?.title ?? "");
	const [description, setDescription] = useState(spec?.description ?? "");
	const [category, setCategory] = useState<TaskCategory | "">(
		spec?.metadata?.category ?? "",
	);
	const [priority, setPriority] = useState<TaskPriority | "">(
		spec?.metadata?.priority ?? "",
	);
	const [complexity, setComplexity] = useState<TaskComplexity | "">(
		spec?.metadata?.complexity ?? "",
	);
	const [impact, setImpact] = useState<TaskImpact | "">(
		spec?.metadata?.impact ?? "",
	);
	const [model, setModel] = useState<ModelTypeShort | "">(
		(spec?.metadata?.model as ModelTypeShort) ?? "",
	);

	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			if (!title.trim() || !description.trim()) return;
			onSave({
				title: title.trim(),
				description: description.trim(),
				category: category || undefined,
				priority: priority || undefined,
				complexity: complexity || undefined,
				impact: impact || undefined,
				model: model || undefined,
			});
		},
		[title, description, category, priority, complexity, impact, model, onSave],
	);

	const isCreate = !spec;

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			{/* Title */}
			<div className="space-y-1.5">
				<Label htmlFor="spec-title">{labels?.title ?? "Title"}</Label>
				<Input
					id="spec-title"
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Enter spec title"
					disabled={isLoading}
					required
				/>
			</div>

			{/* Description */}
			<div className="space-y-1.5">
				<Label htmlFor="spec-description">
					{labels?.description ?? "Description"}
				</Label>
				<Textarea
					id="spec-description"
					className="min-h-[120px] resize-y"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="Describe the task\u2026"
					disabled={isLoading}
					required
				/>
			</div>

			{/* Classification grid */}
			<div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
				<div className="grid grid-cols-2 gap-4">
					{/* Category */}
					<div className="space-y-1.5">
						<Label htmlFor="spec-category">
							{labels?.category ?? "Category"}
						</Label>
						<select
							id="spec-category"
							className={selectClass}
							value={category}
							onChange={(e) =>
								setCategory((e.target.value || "") as TaskCategory | "")
							}
							disabled={isLoading}
						>
							<option value="">Select category</option>
							{CATEGORY_OPTIONS.map((v) => (
								<option key={v} value={v}>
									{v.replace(/_/g, " ")}
								</option>
							))}
						</select>
					</div>

					{/* Priority */}
					<div className="space-y-1.5">
						<Label htmlFor="spec-priority">
							{labels?.priority ?? "Priority"}
						</Label>
						<select
							id="spec-priority"
							className={selectClass}
							value={priority}
							onChange={(e) =>
								setPriority((e.target.value || "") as TaskPriority | "")
							}
							disabled={isLoading}
						>
							<option value="">Select priority</option>
							{PRIORITY_OPTIONS.map((v) => (
								<option key={v} value={v}>
									{v}
								</option>
							))}
						</select>
					</div>

					{/* Complexity */}
					<div className="space-y-1.5">
						<Label htmlFor="spec-complexity">
							{labels?.complexity ?? "Complexity"}
						</Label>
						<select
							id="spec-complexity"
							className={selectClass}
							value={complexity}
							onChange={(e) =>
								setComplexity((e.target.value || "") as TaskComplexity | "")
							}
							disabled={isLoading}
						>
							<option value="">Select complexity</option>
							{COMPLEXITY_OPTIONS.map((v) => (
								<option key={v} value={v}>
									{v}
								</option>
							))}
						</select>
					</div>

					{/* Impact */}
					<div className="space-y-1.5">
						<Label htmlFor="spec-impact">{labels?.impact ?? "Impact"}</Label>
						<select
							id="spec-impact"
							className={selectClass}
							value={impact}
							onChange={(e) =>
								setImpact((e.target.value || "") as TaskImpact | "")
							}
							disabled={isLoading}
						>
							<option value="">Select impact</option>
							{IMPACT_OPTIONS.map((v) => (
								<option key={v} value={v}>
									{v}
								</option>
							))}
						</select>
					</div>
				</div>
			</div>

			{/* Model selection */}
			{availableModels && availableModels.length > 0 && (
				<div className="space-y-1.5">
					<Label htmlFor="spec-model">{labels?.model ?? "Model"}</Label>
					<select
						id="spec-model"
						className={selectClass}
						value={model}
						onChange={(e) =>
							setModel((e.target.value || "") as ModelTypeShort | "")
						}
						disabled={isLoading}
					>
						<option value="">Default</option>
						{availableModels.map((m) => (
							<option key={m} value={m}>
								{m}
							</option>
						))}
					</select>
				</div>
			)}

			{/* Actions */}
			<div className="flex items-center justify-end gap-2 pt-2">
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={isLoading}
				>
					{labels?.cancelButton ?? "Cancel"}
				</Button>
				<Button
					type="submit"
					disabled={isLoading || !title.trim() || !description.trim()}
				>
					{isLoading
						? (labels?.savingButton ?? "Saving\u2026")
						: isCreate
							? (labels?.createButton ?? "Create")
							: (labels?.saveButton ?? "Save")}
				</Button>
			</div>
		</form>
	);
}

export { SpecEditor };
