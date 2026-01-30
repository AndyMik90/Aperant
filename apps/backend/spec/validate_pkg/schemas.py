"""
Validation Schemas
==================

JSON schemas and constants used for validating spec outputs.
"""

# JSON Schemas for validation
IMPLEMENTATION_PLAN_SCHEMA = {
    "required_fields": ["feature", "workflow_type", "phases"],
    "optional_fields": [
        "services_involved",
        "final_acceptance",
        "created_at",
        "updated_at",
        "spec_file",
        "qa_acceptance",
        "qa_signoff",
        "summary",
        "description",
        "workflow_rationale",
        "status",
    ],
    "workflow_types": [
        "feature",
        "refactor",
        "investigation",
        "migration",
        "simple",
        "bugfix",
        "bug_fix",
    ],
    "phase_schema": {
        # Support both old format ("phase" number) and new format ("id" string)
        "required_fields_either": [["phase", "id"]],  # At least one of these
        "required_fields": ["name", "subtasks"],
        "optional_fields": [
            "type",
            "depends_on",
            "parallel_safe",
            "description",
            "phase",
            "id",
        ],
        "phase_types": [
            "setup",
            "implementation",
            "investigation",
            "integration",
            "cleanup",
        ],
    },
    "subtask_schema": {
        "required_fields": ["id", "description", "status"],
        "optional_fields": [
            "service",
            "all_services",
            "files_to_modify",
            "files_to_create",
            "patterns_from",
            "verification",
            "expected_output",
            "actual_output",
            "started_at",
            "completed_at",
            "session_id",
            "critique_result",
        ],
        "status_values": ["pending", "in_progress", "completed", "blocked", "failed"],
    },
    "verification_schema": {
        "required_fields": ["type"],
        "optional_fields": [
            "run",
            "command",
            "expected",
            "url",
            "method",
            "expect_status",
            "expect_contains",
            "scenario",
            "steps",
            "instructions",
        ],
        "verification_types": [
            "command",
            "api",
            "browser",
            "component",  # Legacy - consider deprecating (use "command" with test)
            "e2e",
            "manual",
            "none",
        ],
    },
}

CONTEXT_SCHEMA = {
    "required_fields": ["task_description"],
    "optional_fields": [
        "scoped_services",
        "files_to_modify",
        "files_to_reference",
        "patterns",
        "service_contexts",
        "created_at",
    ],
}

PROJECT_INDEX_SCHEMA = {
    "required_fields": ["project_type"],
    "optional_fields": [
        "services",
        "infrastructure",
        "conventions",
        "root_path",
        "created_at",
        "git_info",
    ],
    "project_types": ["single", "monorepo"],
}

SPEC_REQUIRED_SECTIONS = [
    "Overview",
    "Workflow Type",
    "Task Scope",
    "Success Criteria",
]

SPEC_RECOMMENDED_SECTIONS = [
    "Files to Modify",
    "Files to Reference",
    "Requirements",
    "QA Acceptance Criteria",
]
