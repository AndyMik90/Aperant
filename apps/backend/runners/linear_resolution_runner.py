#!/usr/bin/env python3
"""
Linear Resolution Status Runner
===============================

CLI tool for checking if Linear tickets have already been resolved.

Usage:
    python linear_resolution_runner.py \\
        --project-dir /path/to/project \\
        --ticket-ids LIN-123,LIN-124,LIN-125 \\
        --lookback-days 90
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.linear_resolution_agent import check_tickets_resolution


def main():
    parser = argparse.ArgumentParser(
        description="Check if Linear tickets have already been resolved"
    )
    parser.add_argument(
        "--project-dir",
        required=True,
        type=Path,
        help="Path to the project directory",
    )
    parser.add_argument(
        "--ticket-ids",
        required=True,
        help="Comma-separated list of ticket IDs to check",
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=90,
        help="How many days back to look for fixes (default: 90)",
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

    # Parse ticket IDs
    ticket_ids = [tid.strip() for tid in args.ticket_ids.split(",")]

    # Run analysis
    result = asyncio.run(
        check_tickets_resolution(
            project_dir=str(args.project_dir),
            ticket_ids=ticket_ids,
            lookback_days=args.lookback_days,
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
    tickets = result.get("tickets", [])

    if result.get("error"):
        print(f"❌ Error: {result['error']}")
        return

    print("\n🔍 Resolution Status Check")
    print("=" * 60)

    if not tickets:
        print("\n⚠️ No tickets analyzed.")
        return

    # Group by status
    already_fixed = [t for t in tickets if t.get("is_already_fixed")]
    potentially_fixed = [
        t
        for t in tickets
        if not t.get("is_already_fixed")
        and t.get("recommended_action") == "investigate"
    ]
    still_open = [t for t in tickets if t.get("recommended_action") == "keep_open"]

    if already_fixed:
        print(f"\n✅ Already Fixed ({len(already_fixed)}):")
        print("-" * 60)
        for ticket in already_fixed:
            print(f"\n  📋 {ticket.get('ticket_id', 'unknown')}")
            print(f"     Confidence: {ticket.get('confidence', 'unknown').upper()}")
            print(f"     Reasoning: {ticket.get('reasoning', 'N/A')}")
            evidence = ticket.get("evidence", [])
            if evidence:
                print("     Evidence:")
                for ev in evidence[:3]:
                    print(f"       • {ev.get('description', 'N/A')}")

    if potentially_fixed:
        print(f"\n⚠️ Potentially Fixed ({len(potentially_fixed)}):")
        print("-" * 60)
        for ticket in potentially_fixed:
            print(f"\n  📋 {ticket.get('ticket_id', 'unknown')}")
            print(f"     Confidence: {ticket.get('confidence', 'unknown').upper()}")
            print(f"     Reasoning: {ticket.get('reasoning', 'N/A')}")
            print(
                f"     Action: {ticket.get('recommended_action', 'investigate').upper()}"
            )

    if still_open:
        print(f"\n🔓 Still Open ({len(still_open)}):")
        print("-" * 60)
        for ticket in still_open[:5]:
            print(f"\n  📋 {ticket.get('ticket_id', 'unknown')}")
            print(f"     Reasoning: {ticket.get('reasoning', 'N/A')}")

        if len(still_open) > 5:
            print(f"\n  ... and {len(still_open) - 5} more still open")

    print("\n" + "=" * 60)

    # Summary
    print("\n📊 Summary:")
    print(f"  Total Analyzed: {len(tickets)}")
    print(f"  Already Fixed: {len(already_fixed)}")
    print(f"  Potentially Fixed: {len(potentially_fixed)}")
    print(f"  Still Open: {len(still_open)}")


if __name__ == "__main__":
    main()
