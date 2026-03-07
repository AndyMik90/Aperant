"""
Output formatting for ideation results.

Formats and merges ideation outputs into a cohesive ideation.json file.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from ui import print_status


class IdeationFormatter:
    """Formats ideation output into structured JSON."""

    def __init__(self, output_dir: Path, project_dir: Path):
        self.output_dir = Path(output_dir)
        self.project_dir = Path(project_dir)

    def merge_ideation_outputs(
        self,
        enabled_types: list[str],
        context_data: dict,
        append: bool = False,
    ) -> tuple[Path, int]:
        """Merge all ideation outputs into a single ideation.json.

        Returns: (ideation_file_path, total_ideas_count)
        """
        ideation_file = self.output_dir / "ideation.json"

        # Load existing ideas if in append mode
        existing_ideas = []
        existing_session = None
        if append and ideation_file.exists():
            try:
                with open(ideation_file, encoding="utf-8") as f:
                    existing_session = json.load(f)
                    existing_ideas = existing_session.get("ideas", [])
                    print_status(
                        f"Preserving {len(existing_ideas)} existing ideas", "info"
                    )
            except json.JSONDecodeError:
                pass

        # Collect new ideas from the enabled types
        new_ideas = []
        output_files = []

        for ideation_type in enabled_types:
            type_file = self.output_dir / f"{ideation_type}_ideas.json"
            if type_file.exists():
                try:
                    with open(type_file, encoding="utf-8") as f:
                        data = json.load(f)
                        ideas = data.get(ideation_type, [])
                        new_ideas.extend(ideas)
                        output_files.append(str(type_file))
                except (json.JSONDecodeError, KeyError):
                    pass

        # In append mode, filter out ideas from types we're regenerating
        # (to avoid duplicates) and keep ideas from other types
        if append and existing_ideas:
            # Keep existing ideas that are NOT from the types we just generated
            preserved_ideas = [
                idea for idea in existing_ideas if idea.get("type") not in enabled_types
            ]
            all_ideas = preserved_ideas + new_ideas
            print_status(
                f"Merged: {len(preserved_ideas)} preserved + {len(new_ideas)} new = {len(all_ideas)} total",
                "info",
            )
        else:
            all_ideas = new_ideas

        # Create merged ideation session
        # Preserve session ID and generated_at if appending
        session_id = (
            existing_session.get("id")
            if existing_session
            else f"ideation-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        )
        generated_at = (
            existing_session.get("generated_at")
            if existing_session
            else datetime.now().isoformat()
        )

        ideation_session = {
            "id": session_id,
            "project_id": str(self.project_dir),
            "config": context_data.get("config", {}),
            "ideas": all_ideas,
            "project_context": {
                "existing_features": context_data.get("existing_features", []),
                "tech_stack": context_data.get("tech_stack", []),
                "target_audience": context_data.get("target_audience"),
                "planned_features": context_data.get("planned_features", []),
            },
            "summary": {
                "total_ideas": len(all_ideas),
                "by_type": {},
                "by_status": {},
            },
            "generated_at": generated_at,
            "updated_at": datetime.now().isoformat(),
        }

        # Count by type and status
        for idea in all_ideas:
            idea_type = idea.get("type", "unknown")
            idea_status = idea.get("status", "draft")
            ideation_session["summary"]["by_type"][idea_type] = (
                ideation_session["summary"]["by_type"].get(idea_type, 0) + 1
            )
            ideation_session["summary"]["by_status"][idea_status] = (
                ideation_session["summary"]["by_status"].get(idea_status, 0) + 1
            )

        with open(ideation_file, "w", encoding="utf-8") as f:
            json.dump(ideation_session, f, indent=2)

        action = "Updated" if append else "Created"
        print_status(
            f"{action} ideation.json ({len(all_ideas)} total ideas)", "success"
        )

        return ideation_file, len(all_ideas)

    def load_context(self) -> dict:
        """Load context data from ideation_context.json."""
        context_file = self.output_dir / "ideation_context.json"
        context_data = {}
        if context_file.exists():
            try:
                with open(context_file, encoding="utf-8") as f:
                    context_data = json.load(f)
            except json.JSONDecodeError:
                pass
        return context_data
