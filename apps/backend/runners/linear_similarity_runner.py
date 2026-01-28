#!/usr/bin/env python3
"""
Linear Similarity Runner
========================

CLI tool for analyzing similar Linear tickets.

Usage:
    python linear_similarity_runner.py \\
        --project-dir /path/to/project \\
        --ticket-id LIN-123 \\
        --candidate-ids LIN-124,LIN-125,LIN-126
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.linear_similarity_agent import analyze_ticket_similarity


def main():
    parser = argparse.ArgumentParser(
        description="Analyze similar Linear tickets using AI"
    )
    parser.add_argument(
        "--project-dir",
        required=True,
        type=Path,
        help="Path to the project directory",
    )
    parser.add_argument(
        "--ticket-id",
        required=True,
        help="Target ticket ID to analyze (e.g., LIN-123)",
    )
    parser.add_argument(
        "--candidate-ids",
        help="Comma-separated list of candidate ticket IDs to compare against",
    )
    parser.add_argument(
        "--model",
        default="claude-3-5-sonnet-20241022",
        help="Claude model to use for analysis",
    )
    parser.add_argument(
        "--output",
        choices=["json", "pretty"],
        default="pretty",
        help="Output format",
    )

    args = parser.parse_args()

    # Parse candidate IDs
    candidate_ids = None
    if args.candidate_ids:
        candidate_ids = [cid.strip() for cid in args.candidate_ids.split(",")]

    # Run analysis
    result = asyncio.run(
        analyze_ticket_similarity(
            project_dir=str(args.project_dir),
            target_ticket_id=args.ticket_id,
            candidate_ticket_ids=candidate_ids,
            model=args.model,
        )
    )

    # Output results
    if args.output == "json":
        print(json.dumps(result, indent=2))
    else:
        print_pretty_result(result)


def print_pretty_result(result: dict) -> None:
    """Print results in a human-readable format."""
    target_id = result.get("target_ticket_id", "unknown")
    similar_tickets = result.get("similar_tickets", [])

    if result.get("error"):
        print(f"❌ Error: {result['error']}")
        return

    print(f"\n🔍 Similarity Analysis for Ticket: {target_id}")
    print("=" * 60)

    if not similar_tickets:
        print("\n✅ No similar tickets found.")
        return

    # Group by recommended action
    duplicates = [
        t for t in similar_tickets if t.get("recommended_action") == "duplicate"
    ]
    related = [t for t in similar_tickets if t.get("recommended_action") == "related"]
    distinct = [t for t in similar_tickets if t.get("recommended_action") == "distinct"]

    if duplicates:
        print(f"\n🚨 Potential Duplicates ({len(duplicates)}):")
        print("-" * 60)
        for ticket in duplicates:
            print(f"\n  📋 {ticket.get('ticket_id', 'unknown')}")
            print(f"     Similarity: {ticket.get('similarity_score', 0):.1%}")
            print(f"     Confidence: {ticket.get('confidence', 'unknown').upper()}")
            print(f"     Reasoning: {ticket.get('similarity_reasoning', 'N/A')}")

    if related:
        print(f"\n🔗 Related Tickets ({len(related)}):")
        print("-" * 60)
        for ticket in related:
            print(f"\n  📋 {ticket.get('ticket_id', 'unknown')}")
            print(f"     Similarity: {ticket.get('similarity_score', 0):.1%}")
            print(f"     Confidence: {ticket.get('confidence', 'unknown').upper()}")
            print(f"     Reasoning: {ticket.get('similarity_reasoning', 'N/A')}")

    if distinct:
        print(f"\n✅ Distinct Tickets ({len(distinct)}):")
        print("-" * 60)
        for ticket in distinct[:5]:  # Show first 5 only
            print(f"\n  📋 {ticket.get('ticket_id', 'unknown')}")
            print(f"     Similarity: {ticket.get('similarity_score', 0):.1%}")
            print(f"     Reasoning: {ticket.get('similarity_reasoning', 'N/A')}")

        if len(distinct) > 5:
            print(f"\n  ... and {len(distinct) - 5} more distinct tickets")

    print("\n" + "=" * 60)


if __name__ == "__main__":
    main()
