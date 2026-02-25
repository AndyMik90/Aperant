#!/usr/bin/env python3
"""
Update README.md version badges and download links.

Usage:
    python scripts/update-readme.py <version> [--prerelease]

Examples:
    python scripts/update-readme.py 2.8.0              # Stable release
    python scripts/update-readme.py 2.8.0-beta.1 --prerelease  # Beta release
"""
import argparse
import re
import sys

# Semver pattern: X.Y.Z or X.Y.Z-prerelease.N
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+(-[a-zA-Z]+\.\d+)?$")


def validate_version(version: str) -> bool:
    """Validate version string matches semver format."""
    return bool(SEMVER_PATTERN.match(version))


def update_section(text: str, start_marker: str, end_marker: str, replacements: list) -> str:
    """Update content between markers with given replacements."""
    pattern = f"({re.escape(start_marker)})(.*?)({re.escape(end_marker)})"

    def replace_section(match):
        section = match.group(2)
        for old_pattern, new_value in replacements:
            section = re.sub(old_pattern, new_value, section)
        return match.group(1) + section + match.group(3)

    return re.sub(pattern, replace_section, text, flags=re.DOTALL)


def update_readme(version: str, is_prerelease: bool) -> bool:
    """
    Update README.md with new version.

    Args:
        version: Version string (e.g., "2.8.0" or "2.8.0-beta.1")
        is_prerelease: Whether this is a prerelease version

    Returns:
        True if changes were made, False otherwise
    """
    # Shields.io escapes hyphens as --
    version_badge = version.replace("-", "--")

    # Read README
    with open("README.md", "r") as f:
        original_content = f.read()

    content = original_content

    # Semver pattern: matches X.Y.Z or X.Y.Z-prerelease (e.g., 2.7.2, 2.7.2-beta.10)
    # Prerelease MUST contain a dot (beta.10, alpha.1, rc.1) to avoid matching platform suffixes (win32, darwin)
    semver = r"\d+\.\d+\.\d+(?:-[a-zA-Z]+\.[a-zA-Z0-9.]+)?"
    # Shields.io escaped pattern (hyphens as --)
    semver_badge = r"\d+\.\d+\.\d+(?:--[a-zA-Z]+\.[a-zA-Z0-9.]+)?"

    if is_prerelease:
        print(f"Updating BETA section to {version} (badge: {version_badge})")

        # Update beta badge
        content = re.sub(rf"beta-{semver_badge}-orange", f"beta-{version_badge}-orange", content)

        # Update beta version badge link
        content = update_section(
            content,
            "<!-- BETA_VERSION_BADGE -->",
            "<!-- BETA_VERSION_BADGE_END -->",
            [(rf"tag/v{semver}\)", f"tag/v{version})")],
        )

        # Update beta downloads
        content = update_section(
            content,
            "<!-- BETA_DOWNLOADS -->",
            "<!-- BETA_DOWNLOADS_END -->",
            [
                (rf"Auto-Claude-{semver}", f"Auto-Claude-{version}"),
                (rf"download/v{semver}/", f"download/v{version}/"),
            ],
        )
    else:
        print(f"Updating STABLE section to {version} (badge: {version_badge})")

        # Update top version badge
        content = update_section(
            content,
            "<!-- TOP_VERSION_BADGE -->",
            "<!-- TOP_VERSION_BADGE_END -->",
            [
                (rf"version-{semver_badge}-blue", f"version-{version_badge}-blue"),
                (rf"tag/v{semver}\)", f"tag/v{version})"),
            ],
        )

        # Update stable badge
        content = re.sub(rf"stable-{semver_badge}-blue", f"stable-{version_badge}-blue", content)

        # Update stable version badge link
        content = update_section(
            content,
            "<!-- STABLE_VERSION_BADGE -->",
            "<!-- STABLE_VERSION_BADGE_END -->",
            [(rf"tag/v{semver}\)", f"tag/v{version})")],
        )

        # Update stable downloads
        content = update_section(
            content,
            "<!-- STABLE_DOWNLOADS -->",
            "<!-- STABLE_DOWNLOADS_END -->",
            [
                (rf"Auto-Claude-{semver}", f"Auto-Claude-{version}"),
                (rf"download/v{semver}/", f"download/v{version}/"),
            ],
        )

    # Check if changes were made
    if content == original_content:
        print("No changes needed")
        return False

    # Write updated README
    with open("README.md", "w") as f:
        f.write(content)

    print(f"README.md updated for {version} (prerelease={is_prerelease})")
    return True


def main():
    parser = argparse.ArgumentParser(description="Update README.md version badges and download links")
    parser.add_argument("version", help="Version string (e.g., 2.8.0 or 2.8.0-beta.1)")
    parser.add_argument("--prerelease", action="store_true", help="Mark as prerelease version")
    args = parser.parse_args()

    # Validate version format
    if not validate_version(args.version):
        print(f"ERROR: Invalid version format: {args.version}", file=sys.stderr)
        print("Expected format: X.Y.Z or X.Y.Z-prerelease.N (e.g., 2.8.0 or 2.8.0-beta.1)", file=sys.stderr)
        sys.exit(1)

    # Auto-detect prerelease if not explicitly set
    is_prerelease = args.prerelease or ("-" in args.version)

    try:
        changed = update_readme(args.version, is_prerelease)
        sys.exit(0 if changed else 0)  # Exit 0 in both cases (no error)
    except FileNotFoundError:
        print("ERROR: README.md not found", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
