"""
Input Handlers
==============

Reusable user input collection utilities for CLI commands.
"""

import sys
from pathlib import Path

# Ensure parent directory is in path for imports (before other imports)
_PARENT_DIR = Path(__file__).parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from ui import (
    Icons,
    MenuOption,
    box,
    icon,
    muted,
    print_status,
    select_menu,
)


def collect_user_input_interactive(
    title: str,
    subtitle: str,
    prompt_text: str,
    allow_file: bool = True,
    allow_paste: bool = True,
) -> str | None:
    """
    Collect user input through an interactive menu.

    Provides multiple input methods:
    - Type directly
    - Paste from clipboard
    - Read from file (optional)

    Args:
        title: Menu title
        subtitle: Menu subtitle
        prompt_text: Text to display in the input box
        allow_file: Whether to allow file input (default: True)
        allow_paste: Whether to allow paste option (default: True)

    Returns:
        The collected input string, or None if cancelled
    """
    # Build options list
    options = [
        MenuOption(
            key="type",
            label="Type instructions",
            icon=Icons.EDIT,
            description="Enter text directly",
        ),
    ]

    if allow_paste:
        options.append(
            MenuOption(
                key="paste",
                label="Paste from clipboard",
                icon=Icons.CLIPBOARD,
                description="Paste text you've copied (Cmd+V / Ctrl+Shift+V)",
            )
        )

    if allow_file:
        options.append(
            MenuOption(
                key="file",
                label="Read from file",
                icon=Icons.DOCUMENT,
                description="Load text from a file",
            )
        )

    options.extend(
        [
            MenuOption(
                key="skip",
                label="Continue without input",
                icon=Icons.SKIP,
                description="Skip this step",
            ),
            MenuOption(
                key="quit",
                label="Quit",
                icon=Icons.DOOR,
                description="Exit",
            ),
        ]
    )

    choice = select_menu(
        title=title,
        options=options,
        subtitle=subtitle,
        allow_quit=False,  # We have explicit quit option
    )

    if choice == "quit" or choice is None:
        return None

    if choice == "skip":
        return ""

    user_input = ""

    if choice == "file":
        # Read from file
        user_input = read_from_file()
        if user_input is None:
            return None

    elif choice in ["type", "paste"]:
        user_input = read_multiline_input(prompt_text)
        if user_input is None:
            return None

    return user_input


def read_from_file() -> str | None:
    """
    Read text content from a file path provided by the user.

    Returns:
        File contents as string, or None if cancelled/error
    """
    print()
    print(f"{icon(Icons.DOCUMENT)} Enter the path to your file:")
    try:
        file_path_input = input(f"  {icon(Icons.POINTER)} ").strip()
    except (KeyboardInterrupt, EOFError):
        print()
        print_status("Cancelled.", "warning")
        return None

    if not file_path_input:
        print_status("No file path provided.", "warning")
        return None

    try:
        # Expand ~ and resolve path
        file_path = Path(file_path_input).expanduser().resolve()
        if file_path.exists():
            content = file_path.read_text(encoding="utf-8").strip()
            if content:
                print_status(
                    f"Loaded {len(content)} characters from file",
                    "success",
                )
                return content
            else:
                print_status("File is empty.", "error")
                return None
        else:
            print_status(f"File not found: {file_path}", "error")
            return None
    except PermissionError:
        print_status(f"Permission denied: cannot read {file_path_input}", "error")
        return None
    except Exception as e:
        print_status(f"Error reading file: {e}", "error")
        return None


def read_multiline_input(prompt_text: str) -> str | None:
    """
    Read multi-line input from the user.

    Args:
        prompt_text: Text to display in the prompt box

    Returns:
        User input as string, or None if cancelled
    """
    print()
    content = [
        prompt_text,
        muted("Press Enter on an empty line when done."),
    ]
    print(box(content, width=60, style="light"))
    print()

    lines = []
    empty_count = 0
    while True:
        try:
            line = input()
            if line == "":
                empty_count += 1
                if empty_count >= 1:  # Stop on first empty line
                    break
            else:
                empty_count = 0
                lines.append(line)
        except KeyboardInterrupt:
            print()
            print_status("Cancelled.", "warning")
            return None
        except EOFError:
            break

    return "\n".join(lines).strip()
