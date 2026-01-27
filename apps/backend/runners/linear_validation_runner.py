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
import logging
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

from agents.linear_validator import ValidationError, create_linear_validator

logger = logging.getLogger(__name__)


def output_result(result: dict) -> None:
    """Output result as JSON to stdout."""
    print(json.dumps(result, ensure_ascii=False, indent=2))


def _serialize_validation_result(result: dict, ticket_id: str) -> dict:
    """Convert validation result to JSON-serializable format.

    Args:
        result: Raw validation result from the agent
        ticket_id: The ticket identifier for fallback

    Returns:
        Serialized validation result with all fields
    """
    analysis = result.get("analysis", {})
    completeness = result.get("completeness", {})
    labels = result.get("recommended_labels", [])
    properties = result.get("properties", {})

    return {
        "ticketIdentifier": result.get("issue_id", ticket_id),
        "validationTimestamp": result.get("validation_timestamp", ""),
        "cached": result.get("cached", False),
        "status": result.get("status", "complete"),
        "confidence": result.get("confidence", 0.0),
        "reasoning": result.get("reasoning", ""),
        "contentAnalysis": {
            "title": analysis.get("title", result.get("title", "")),
            "descriptionSummary": analysis.get(
                "description_summary", analysis.get("summary", "")
            ),
            "requirements": analysis.get("requirements", []),
        },
        "completenessValidation": {
            "isComplete": completeness.get("title_clear", False)
            and completeness.get("description_sufficient", False),
            "feasibilityScore": completeness.get("feasibility_score", 0.0),
            "missingFields": completeness.get("missing_info", []),
            "validationNotes": completeness.get("feasibility", ""),
        },
        "suggestedLabels": [
            {
                "name": label.get("name", label) if isinstance(label, dict) else label,
                "confidence": label.get("confidence", 0.0)
                if isinstance(label, dict)
                else 0.0,
                "reason": label.get("reason", "") if isinstance(label, dict) else "",
            }
            for label in labels
        ],
        "versionRecommendation": {
            "currentVersion": result.get("current_version", ""),
            "recommendedVersion": result.get(
                "version_label", result.get("recommended_version", "")
            ),
            "versionType": result.get("version_type", "patch"),
            "reasoning": result.get("version_reasoning", ""),
        },
        "taskProperties": {
            "category": properties.get("category", "feature"),
            "complexity": properties.get("complexity", "medium"),
            "impact": properties.get("impact", "medium"),
            "priority": properties.get("priority", "normal"),
            "rationale": result.get("reasoning", ""),
            "acceptanceCriteria": analysis.get("requirements", []),
        },
    }


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
        agent = create_linear_validator(
            project_dir, project_dir, model="claude-opus-4-5-20251101"
        )

        # validate_ticket now auto-fetches issue data if not provided
        result = await agent.validate_ticket(
            ticket_id, issue_data=None, skip_cache=skip_cache
        )

        # Use helper to serialize the result
        return {
            "success": True,
            "data": {
                "ticketId": ticket_id,
                **_serialize_validation_result(result, ticket_id),
            },
        }
    except ValidationError as e:
        return {
            "success": False,
            "error": str(e),
        }
    except Exception as e:
        logger.exception(f"Unexpected error validating ticket {ticket_id}")
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
        agent = create_linear_validator(
            project_dir, project_dir, model="claude-opus-4-5-20251101"
        )

        # Convert ticket IDs to the format expected by validate_batch
        # validate_batch expects: [{'id': ticket_id, 'data': {...}}, ...]
        # Since we now auto-fetch data, we can pass None for data
        issues = [{"id": ticket_id, "data": None} for ticket_id in ticket_ids]

        results = await agent.validate_batch(issues, skip_cache=skip_cache)

        # Convert successful results to serializable format
        successful_results = []
        for result in results.get("successful", []):
            # Extract ticket_id from result
            ticket_id = result.get("ticketId") or result.get("issue_id", "")
            # Use helper to serialize the result
            successful_results.append(
                {
                    "ticketId": ticket_id,
                    "result": _serialize_validation_result(result, ticket_id),
                }
            )

        # Convert failed results
        failed_results = []
        for result in results.get("failed", []):
            ticket_id = result.get("ticketId") or result.get("issue_id", "")
            failed_results.append(
                {
                    "ticketId": ticket_id,
                    "error": result.get("error", "Unknown error"),
                }
            )

        return {
            "success": True,
            "data": {
                "successful": successful_results,
                "failed": failed_results,
                "summary": results.get("summary", {}),
            },
        }
    except ValidationError as e:
        return {
            "success": False,
            "error": str(e),
        }
    except Exception as e:
        logger.exception("Unexpected error in batch validation")
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
        ticket_ids = [t.strip() for t in args.ticket_ids.split(",") if t.strip()]
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
