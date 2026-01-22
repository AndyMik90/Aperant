#!/usr/bin/env python3
"""
Linear Validation Runner
========================

CLI wrapper for validating Linear tickets using AI.
Outputs JSON results to stdout for IPC communication.

Usage:
    python runners/linear_validation_runner.py \\
        --project-dir /path/to/project \\
        --ticket-id LIN-123 \\
        --skip-cache

    python runners/linear_validation_runner.py \\
        --project-dir /path/to/project \\
        --ticket-ids LIN-123,LIN-456,LIN-789 \\
        --skip-cache
"""

import asyncio
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Validate platform-specific dependencies
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

# Load .env file
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

from agents.linear_validator import LinearValidationError, create_linear_validator


def output_result(result: dict) -> None:
    """Output result as JSON to stdout."""
    print(json.dumps(result, ensure_ascii=False, indent=2))


async def validate_single_ticket(
    project_dir: Path,
    ticket_id: str,
    skip_cache: bool = False,
) -> dict:
    """Validate a single Linear ticket.

    Args:
        project_dir: Project directory path
        ticket_id: Linear ticket identifier (e.g., LIN-123)
        skip_cache: Whether to skip cache and force re-validation

    Returns:
        Dict with success status and either data or error
    """
    try:
        agent = create_linear_validator(project_dir, project_dir, model="opus")

        result = await agent.validate_ticket(ticket_id, skip_cache=skip_cache)

        # Convert to serializable format
        return {
            "success": True,
            "data": {
                "ticketId": ticket_id,
                "ticketIdentifier": result.ticket_id,
                "validationTimestamp": result.validation_timestamp,
                "cached": result.cached,
                "status": result.status,
                "confidence": result.confidence,
                "reasoning": result.reasoning,
                "contentAnalysis": {
                    "title": result.content_analysis.title,
                    "descriptionSummary": result.content_analysis.description_summary,
                    "requirements": result.content_analysis.requirements,
                },
                "completenessValidation": {
                    "isComplete": result.completeness_validation.is_complete,
                    "score": result.completeness_validation.feasibility_score,
                    "missingFields": result.completeness_validation.missing_fields,
                    "validationNotes": result.completeness_validation.validation_notes,
                },
                "suggestedLabels": [
                    {
                        "name": label.name,
                        "confidence": label.confidence,
                        "reason": label.reason,
                    }
                    for label in result.suggested_labels
                ],
                "versionRecommendation": {
                    "currentVersion": result.version_recommendation.current_version,
                    "recommendedVersion": result.version_recommendation.recommended_version,
                    "versionType": result.version_recommendation.version_type,
                    "reasoning": result.version_recommendation.reasoning,
                },
                "taskProperties": {
                    "category": result.task_properties.category,
                    "complexity": result.task_properties.complexity,
                    "impact": result.task_properties.impact,
                    "priority": result.task_properties.priority,
                    "rationale": result.task_properties.rationale,
                    "acceptanceCriteria": result.content_analysis.requirements,
                },
            },
        }
    except LinearValidationError as e:
        return {
            "success": False,
            "error": str(e),
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Validation failed: {e}",
        }


async def validate_batch_tickets(
    project_dir: Path,
    ticket_ids: list[str],
    skip_cache: bool = False,
) -> dict:
    """Validate multiple Linear tickets in batch.

    Args:
        project_dir: Project directory path
        ticket_ids: List of Linear ticket identifiers
        skip_cache: Whether to skip cache and force re-validation

    Returns:
        Dict with successful and failed results
    """
    try:
        agent = create_linear_validator(project_dir, project_dir, model="opus")

        results = await agent.validate_batch(ticket_ids, skip_cache=skip_cache)

        # Convert to serializable format
        successful = []
        failed = []

        for ticket_id, result in results.items():
            if isinstance(result, Exception):
                failed.append(
                    {
                        "ticketId": ticket_id,
                        "error": str(result),
                    }
                )
            else:
                successful.append(
                    {
                        "ticketId": ticket_id,
                        "result": {
                            "ticketIdentifier": result.ticket_id,
                            "validationTimestamp": result.validation_timestamp,
                            "cached": result.cached,
                            "status": result.status,
                            "confidence": result.confidence,
                            "reasoning": result.reasoning,
                            "contentAnalysis": {
                                "title": result.content_analysis.title,
                                "descriptionSummary": result.content_analysis.description_summary,
                                "requirements": result.content_analysis.requirements,
                            },
                            "completenessValidation": {
                                "isComplete": result.completeness_validation.is_complete,
                                "score": result.completeness_validation.feasibility_score,
                                "missingFields": result.completeness_validation.missing_fields,
                                "validationNotes": result.completeness_validation.validation_notes,
                            },
                            "suggestedLabels": [
                                {
                                    "name": label.name,
                                    "confidence": label.confidence,
                                    "reason": label.reason,
                                }
                                for label in result.suggested_labels
                            ],
                            "versionRecommendation": {
                                "currentVersion": result.version_recommendation.current_version,
                                "recommendedVersion": result.version_recommendation.recommended_version,
                                "versionType": result.version_recommendation.version_type,
                                "reasoning": result.version_recommendation.reasoning,
                            },
                            "taskProperties": {
                                "category": result.task_properties.category,
                                "complexity": result.task_properties.complexity,
                                "impact": result.task_properties.impact,
                                "priority": result.task_properties.priority,
                                "rationale": result.task_properties.rationale,
                                "acceptanceCriteria": result.content_analysis.requirements,
                            },
                        },
                    }
                )

        return {
            "success": True,
            "data": {
                "successful": successful,
                "failed": failed,
            },
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Batch validation failed: {e}",
        }


async def main():
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Validate Linear tickets using AI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        required=True,
        help="Project directory path",
    )
    parser.add_argument(
        "--ticket-id",
        type=str,
        help="Single ticket ID to validate (e.g., LIN-123)",
    )
    parser.add_argument(
        "--ticket-ids",
        type=str,
        help="Comma-separated ticket IDs for batch validation (e.g., LIN-123,LIN-456)",
    )
    parser.add_argument(
        "--skip-cache",
        action="store_true",
        help="Skip cache and force re-validation",
    )

    args = parser.parse_args()

    # Validate project directory
    project_dir = args.project_dir.resolve()
    if not project_dir.exists():
        output_result(
            {
                "success": False,
                "error": f"Project directory does not exist: {project_dir}",
            }
        )
        sys.exit(1)

    # Determine mode
    if args.ticket_id:
        # Single ticket validation
        result = await validate_single_ticket(
            project_dir,
            args.ticket_id,
            args.skip_cache,
        )
        output_result(result)
        sys.exit(0 if result["success"] else 1)
    elif args.ticket_ids:
        # Batch validation
        ticket_ids = [t.strip() for t in args.ticket_ids.split(",")]
        if len(ticket_ids) > 5:
            output_result(
                {"success": False, "error": "Maximum 5 tickets allowed per batch"}
            )
            sys.exit(1)

        result = await validate_batch_tickets(
            project_dir,
            ticket_ids,
            args.skip_cache,
        )
        output_result(result)
        sys.exit(0 if result["success"] else 1)
    else:
        output_result(
            {
                "success": False,
                "error": "Must specify either --ticket-id or --ticket-ids",
            }
        )
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        output_result({"success": False, "error": "Validation interrupted"})
        sys.exit(1)
