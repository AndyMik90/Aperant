/**
 * useValidationEditState Hook
 * ===========================
 *
 * Manages edit state for validation results (labels, version, properties).
 * Provides edit mode toggles, value management, and change detection.
 */

import { useEffect, useState } from 'react';
import type { TaskCategory, TaskComplexity, TaskImpact, TaskPriority, ValidationResult } from '../../../../shared/types';

interface EditState {
	editedLabels: Array<{ name: string; confidence: number; reason: string }>;
	editedVersion: string;
	editedCategory: TaskCategory;
	editedComplexity: TaskComplexity;
	editedImpact: TaskImpact;
	editedPriority: TaskPriority;
}

interface EditModeState {
	editingLabels: boolean;
	editingVersion: boolean;
	editingProperties: boolean;
}

export function useValidationEditState(validation: ValidationResult | null) {
	// Initialize edit state from validation data
	const [editState, setEditState] = useState<EditState>({
		editedLabels: [],
		editedVersion: '',
		editedCategory: 'feature',
		editedComplexity: 'medium',
		editedImpact: 'medium',
		editedPriority: 'medium',
	});

	const [editMode, setEditMode] = useState<EditModeState>({
		editingLabels: false,
		editingVersion: false,
		editingProperties: false,
	});

	// Update edit state when validation changes
	useEffect(() => {
		if (validation) {
			setEditState({
				editedLabels: validation.suggestedLabels || [],
				editedVersion: validation.versionRecommendation?.recommendedVersion || '',
				editedCategory: validation.taskProperties?.category || 'feature',
				editedComplexity: validation.taskProperties?.complexity || 'medium',
				editedImpact: validation.taskProperties?.impact || 'medium',
				editedPriority: validation.taskProperties?.priority || 'medium',
			});
		}
	}, [validation]);

	// Compute if there are any changes from the original validation
	const hasChanges = Boolean(
		validation && (
			JSON.stringify(editState.editedLabels) !== JSON.stringify(validation.suggestedLabels) ||
			editState.editedVersion !== (validation.versionRecommendation?.recommendedVersion || '') ||
			editState.editedCategory !== (validation.taskProperties?.category || 'feature') ||
			editState.editedComplexity !== (validation.taskProperties?.complexity || 'medium') ||
			editState.editedImpact !== (validation.taskProperties?.impact || 'medium') ||
			editState.editedPriority !== (validation.taskProperties?.priority || 'medium')
		)
	);

	// Build updated validation result with edited values
	const getUpdatedValidation = (): ValidationResult => {
		if (!validation) {
			throw new Error('Cannot update validation: no validation data available');
		}

		return {
			...validation,
			suggestedLabels: editState.editedLabels,
			versionRecommendation: {
				...(validation.versionRecommendation || {}),
				recommendedVersion: editState.editedVersion,
			},
			taskProperties: {
				...(validation.taskProperties || {}),
				category: editState.editedCategory,
				complexity: editState.editedComplexity,
				impact: editState.editedImpact,
				priority: editState.editedPriority,
			},
		};
	};

	// Reset to original validation values
	const discardChanges = () => {
		if (validation) {
			setEditState({
				editedLabels: validation.suggestedLabels || [],
				editedVersion: validation.versionRecommendation?.recommendedVersion || '',
				editedCategory: validation.taskProperties?.category || 'feature',
				editedComplexity: validation.taskProperties?.complexity || 'medium',
				editedImpact: validation.taskProperties?.impact || 'medium',
				editedPriority: validation.taskProperties?.priority || 'medium',
			});
		}
	};

	// Individual setters for edit mode
	const setEditingLabels = (value: boolean) => {
		setEditMode(prev => ({ ...prev, editingLabels: value }));
	};

	const setEditingVersion = (value: boolean) => {
		setEditMode(prev => ({ ...prev, editingVersion: value }));
	};

	const setEditingProperties = (value: boolean) => {
		setEditMode(prev => ({ ...prev, editingProperties: value }));
	};

	// Individual setters for edit values
	const setEditedLabels = (labels: Array<{ name: string; confidence: number; reason: string }>) => {
		setEditState(prev => ({ ...prev, editedLabels: labels }));
	};

	const setEditedVersion = (version: string) => {
		setEditState(prev => ({ ...prev, editedVersion: version }));
	};

	const setEditedCategory = (category: TaskCategory) => {
		setEditState(prev => ({ ...prev, editedCategory: category }));
	};

	const setEditedComplexity = (complexity: TaskComplexity) => {
		setEditState(prev => ({ ...prev, editedComplexity: complexity }));
	};

	const setEditedImpact = (impact: TaskImpact) => {
		setEditState(prev => ({ ...prev, editedImpact: impact }));
	};

	const setEditedPriority = (priority: TaskPriority) => {
		setEditState(prev => ({ ...prev, editedPriority: priority }));
	};

	return {
		// Edit values
		editedLabels: editState.editedLabels,
		editedVersion: editState.editedVersion,
		editedCategory: editState.editedCategory,
		editedComplexity: editState.editedComplexity,
		editedImpact: editState.editedImpact,
		editedPriority: editState.editedPriority,

		// Edit mode
		editingLabels: editMode.editingLabels,
		editingVersion: editMode.editingVersion,
		editingProperties: editMode.editingProperties,

		// Actions
		setEditingLabels,
		setEditingVersion,
		setEditingProperties,
		setEditedLabels,
		setEditedVersion,
		setEditedCategory,
		setEditedComplexity,
		setEditedImpact,
		setEditedPriority,

		// Utilities
		hasChanges,
		getUpdatedValidation,
		discardChanges,
	};
}
