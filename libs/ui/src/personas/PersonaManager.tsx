/**
 * PersonaManager — Full CRUD management panel for agent personas.
 *
 * Combines PersonaList with an inline editor form for creating/editing personas.
 * Pure prop-driven component with no direct store or i18n dependencies.
 */

import type { AgentProfile } from "@auto-claude/types";
import * as React from "react";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";
import { PersonaList } from "./PersonaList";

export interface PersonaFormData {
	name: string;
	description: string;
	model: string;
	thinkingLevel: string;
	icon?: string;
}

export interface PersonaManagerLabels {
	heading?: string;
	createButton?: string;
	createFormTitle?: string;
	editFormTitle?: string;
	nameLabel?: string;
	descriptionLabel?: string;
	modelLabel?: string;
	thinkingLevelLabel?: string;
	submitCreate?: string;
	submitSave?: string;
	cancel?: string;
}

export interface PersonaManagerProps {
	personas: AgentProfile[];
	activePersonaId?: string;
	onCreate: (data: PersonaFormData) => void;
	onUpdate: (id: string, data: PersonaFormData) => void;
	onDelete: (id: string) => void;
	onSelect?: (id: string) => void;
	isLoading?: boolean;
	maxPersonas?: number;
	/** Override default English labels for i18n */
	labels?: PersonaManagerLabels;
}

const MODEL_OPTIONS = [
	{ value: "opus", label: "Opus" },
	{ value: "sonnet", label: "Sonnet" },
	{ value: "haiku", label: "Haiku" },
] as const;

const THINKING_OPTIONS = [
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
] as const;

function PersonaManager({
	personas,
	activePersonaId,
	onCreate,
	onUpdate,
	onDelete,
	onSelect,
	isLoading = false,
	maxPersonas,
	labels,
}: PersonaManagerProps) {
	const [editingId, setEditingId] = React.useState<string | null>(null);
	const [isCreating, setIsCreating] = React.useState(false);
	const [formData, setFormData] = React.useState<PersonaFormData>({
		name: "",
		description: "",
		model: "sonnet",
		thinkingLevel: "medium",
	});

	const atLimit = maxPersonas !== undefined && personas.length >= maxPersonas;

	const handleStartCreate = () => {
		setEditingId(null);
		setFormData({
			name: "",
			description: "",
			model: "sonnet",
			thinkingLevel: "medium",
		});
		setIsCreating(true);
	};

	const handleStartEdit = (id: string) => {
		const persona = personas.find((p) => p.id === id);
		if (!persona) return;
		setIsCreating(false);
		setEditingId(id);
		setFormData({
			name: persona.name,
			description: persona.description,
			model: persona.model,
			thinkingLevel: persona.thinkingLevel,
			icon: persona.icon,
		});
	};

	const handleCancel = () => {
		setEditingId(null);
		setIsCreating(false);
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!formData.name.trim()) return;

		if (isCreating) {
			onCreate(formData);
		} else if (editingId) {
			onUpdate(editingId, formData);
		}
		handleCancel();
	};

	const selectClass =
		"flex h-9 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-200";

	const renderForm = () => (
		<form
			onSubmit={handleSubmit}
			className="rounded-lg border border-border bg-card p-4 space-y-3"
		>
			<h4 className="text-sm font-medium">
				{isCreating
					? (labels?.createFormTitle ?? "Create Persona")
					: (labels?.editFormTitle ?? "Edit Persona")}
			</h4>

			<div className="space-y-2">
				<Label htmlFor="persona-name">{labels?.nameLabel ?? "Name"}</Label>
				<Input
					id="persona-name"
					type="text"
					value={formData.name}
					onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
					placeholder="Persona name"
					required
				/>
			</div>

			<div className="space-y-2">
				<Label htmlFor="persona-desc">
					{labels?.descriptionLabel ?? "Description"}
				</Label>
				<Input
					id="persona-desc"
					type="text"
					value={formData.description}
					onChange={(e) =>
						setFormData((d) => ({ ...d, description: e.target.value }))
					}
					placeholder="Brief description"
				/>
			</div>

			<div className="flex gap-3">
				<div className="flex-1 space-y-2">
					<Label htmlFor="persona-model">{labels?.modelLabel ?? "Model"}</Label>
					<select
						id="persona-model"
						className={selectClass}
						value={formData.model}
						onChange={(e) =>
							setFormData((d) => ({ ...d, model: e.target.value }))
						}
					>
						{MODEL_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
				</div>

				<div className="flex-1 space-y-2">
					<Label htmlFor="persona-thinking">
						{labels?.thinkingLevelLabel ?? "Thinking Level"}
					</Label>
					<select
						id="persona-thinking"
						className={selectClass}
						value={formData.thinkingLevel}
						onChange={(e) =>
							setFormData((d) => ({ ...d, thinkingLevel: e.target.value }))
						}
					>
						{THINKING_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
				</div>
			</div>

			<div className="flex items-center gap-2 pt-1">
				<Button type="submit" size="sm">
					{isCreating
						? (labels?.submitCreate ?? "Create")
						: (labels?.submitSave ?? "Save")}
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
					{labels?.cancel ?? "Cancel"}
				</Button>
			</div>
		</form>
	);

	return (
		<div className="space-y-4">
			{/* Header with create button */}
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">{labels?.heading ?? "Personas"}</h3>
				{!isCreating && !editingId && (
					<Button
						type="button"
						size="sm"
						onClick={handleStartCreate}
						disabled={atLimit}
						title={
							atLimit ? `Maximum of ${maxPersonas} personas reached` : undefined
						}
					>
						{labels?.createButton ?? "New Persona"}
					</Button>
				)}
			</div>

			{/* Inline editor form */}
			{(isCreating || editingId) && renderForm()}

			{/* Persona list */}
			<PersonaList
				personas={personas}
				isLoading={isLoading}
				onEdit={handleStartEdit}
				onDelete={onDelete}
				onSelect={onSelect}
				activePersonaId={activePersonaId}
				emptyStateMessage="No personas configured. Create one to get started."
			/>
		</div>
	);
}

export { PersonaManager };
