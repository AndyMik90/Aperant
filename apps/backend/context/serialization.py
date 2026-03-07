"""
Context Serialization
=====================

Handles serialization and deserialization of task context.
"""

import json
from pathlib import Path

from .models import TaskContext


def serialize_context(context: TaskContext) -> dict:
    """
    Convert TaskContext to dictionary for JSON serialization.

    Args:
        context: TaskContext object to serialize

    Returns:
        Dictionary representation
    """
    return {
        "task_description": context.task_description,
        "scoped_services": context.scoped_services,
        "files_to_modify": context.files_to_modify,
        "files_to_reference": context.files_to_reference,
        "patterns": context.patterns_discovered,
        "service_contexts": context.service_contexts,
        "graph_hints": context.graph_hints,
    }


def save_context(context: TaskContext, output_file: Path) -> None:
    """
    Save task context to JSON file.

    Args:
        context: TaskContext to save
        output_file: Path to output JSON file
    """
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(serialize_context(context), f, indent=2)


def load_context(input_file: Path) -> dict:
    """
    Load task context from JSON file.

    Args:
        input_file: Path to JSON file

    Returns:
        Context dictionary
    """
    with open(input_file, encoding="utf-8") as f:
        return json.load(f)
