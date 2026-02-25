#!/usr/bin/env python3
"""
Check File Encoding
===================

Pre-commit hook to ensure all file operations specify UTF-8 encoding.

This prevents Windows encoding issues where Python defaults to cp1252 instead of UTF-8.
"""

import argparse
import re
import sys
from pathlib import Path

# Fix Windows console encoding for emoji output
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        # Python < 3.7
        import codecs
        sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')


class EncodingChecker:
    """Checks Python files for missing UTF-8 encoding parameters."""

    def __init__(self):
        self.issues = []

    def check_file(self, filepath: Path) -> bool:
        """
        Check a single Python file for encoding issues.

        Returns:
            True if file passes checks, False if issues found
        """
        try:
            content = filepath.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            self.issues.append(f"{filepath}: File is not UTF-8 encoded")
            return False
        except OSError as e:
            self.issues.append(f"{filepath}: Cannot read file ({e})")
            return False

        file_issues = []

        # Check 1: open() without encoding
        # Pattern: open(...) without encoding= parameter
        # Use negative lookbehind to exclude os.open(), urlopen(), etc.
        for match in re.finditer(r'(?<![a-zA-Z_\.])open\s*\([^)]+\)', content):
            call = match.group()

            # Skip if it's binary mode (must contain 'b' in mode string)
            # Matches: "rb", "wb", "ab", "r+b", "w+b", etc.
            if re.search(r'["\'][rwax+]*b[rwax+]*["\']', call):
                continue

            # Skip if it already has encoding (use word boundary for robustness)
            if re.search(r'\bencoding\s*=', call):
                continue

            # Get line number
            line_num = content[:match.start()].count('\n') + 1
            file_issues.append(
                f"{filepath}:{line_num} - open() without encoding parameter"
            )

        # Check 2: Path.read_text() without encoding
        # Match .read_text() calls - both variable.read_text() and Path(...).read_text()
        for match in re.finditer(r'(?:(\w+)|(\))\s*)\.read_text\s*\(', content):
            var_name = match.group(1)  # Will be None if matched closing paren
            start_pos = match.end()

            # Find the matching closing parenthesis (handle nesting)
            paren_depth = 1
            end_pos = start_pos
            while end_pos < len(content) and paren_depth > 0:
                if content[end_pos] == '(':
                    paren_depth += 1
                elif content[end_pos] == ')':
                    paren_depth -= 1
                end_pos += 1
            args = content[start_pos:end_pos - 1] if end_pos > start_pos else ""

            # Skip if it already has encoding
            if re.search(r'\bencoding\s*=', args):
                continue

            # Skip method calls on self/cls (custom methods, not Path)
            if var_name in ('self', 'cls'):
                continue

            # Skip if var_name is 'Path' (class name reference, not instance call)
            if var_name == 'Path':
                continue

            # Skip if it's a custom method call (e.g., self.parser.read_text)
            # Check the characters immediately before the matched variable name
            if var_name:
                prefix_start = max(0, match.start() - 10)
                prefix = content[prefix_start:match.start()]
                if re.search(r'\bself\.$', prefix) or re.search(r'\bcls\.$', prefix):
                    continue

            line_num = content[:match.start()].count('\n') + 1
            file_issues.append(
                f"{filepath}:{line_num} - .read_text() without encoding parameter"
            )

        # Check 3: Path.write_text() without encoding
        # Match .write_text() calls - both variable.write_text() and Path(...).write_text()
        for match in re.finditer(r'(?:(\w+)|(\))\s*)\.write_text\s*\(', content):
            var_name = match.group(1)  # Will be None if matched closing paren
            start_pos = match.end()

            # Find the matching closing parenthesis (handle nesting)
            paren_depth = 1
            end_pos = start_pos
            while end_pos < len(content) and paren_depth > 0:
                if content[end_pos] == '(':
                    paren_depth += 1
                elif content[end_pos] == ')':
                    paren_depth -= 1
                end_pos += 1
            args = content[start_pos:end_pos - 1] if end_pos > start_pos else ""

            # Skip if it already has encoding
            if re.search(r'\bencoding\s*=', args):
                continue

            # Skip method calls on self/cls (custom methods, not Path)
            if var_name in ('self', 'cls'):
                continue

            # Skip if var_name is 'Path' (class name reference, not instance call)
            if var_name == 'Path':
                continue

            # Skip if it's a custom method call (e.g., self.parser.write_text)
            # Check the characters immediately before the matched variable name
            if var_name:
                prefix_start = max(0, match.start() - 10)
                prefix = content[prefix_start:match.start()]
                if re.search(r'\bself\.$', prefix) or re.search(r'\bcls\.$', prefix):
                    continue

            line_num = content[:match.start()].count('\n') + 1
            file_issues.append(
                f"{filepath}:{line_num} - .write_text() without encoding parameter"
            )

        # Check 4: json.load() with open() without encoding
        for match in re.finditer(r'json\.load\s*\(\s*open\s*\([^)]+\)', content):
            call = match.group()

            # Skip if open() has encoding (use word boundary for robustness)
            if re.search(r'\bencoding\s*=', call):
                continue

            line_num = content[:match.start()].count('\n') + 1
            file_issues.append(
                f"{filepath}:{line_num} - json.load(open()) without encoding in open()"
            )

        # Check 5: json.dump() with open() without encoding
        for match in re.finditer(r'json\.dump\s*\([^,]+,\s*open\s*\([^)]+\)', content):
            call = match.group()

            # Skip if open() has encoding (use word boundary for robustness)
            if re.search(r'\bencoding\s*=', call):
                continue

            line_num = content[:match.start()].count('\n') + 1
            file_issues.append(
                f"{filepath}:{line_num} - json.dump(..., open()) without encoding in open()"
            )

        self.issues.extend(file_issues)
        return len(file_issues) == 0

    def check_files(self, filepaths: list[Path]) -> int:
        """
        Check multiple files.

        Returns:
            Number of files with issues
        """
        for filepath in filepaths:
            if not filepath.exists():
                continue

            if not filepath.suffix == '.py':
                continue

            self.check_file(filepath)

        return len([f for f in self.issues if f])


def main():
    """Main entry point for pre-commit hook."""
    parser = argparse.ArgumentParser(
        description="Check Python files for missing UTF-8 encoding parameters"
    )
    parser.add_argument(
        'filenames',
        nargs='*',
        help='Filenames to check'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Show all issues found'
    )

    args = parser.parse_args()

    # Convert filenames to Path objects
    files = [Path(f) for f in args.filenames]

    # Run checks
    checker = EncodingChecker()
    checker.check_files(files)

    # Report results
    if checker.issues:
        print("❌ Encoding issues found:")
        print()
        for issue in checker.issues:
            print(f"  {issue}")
        print()
        print("💡 Fix: Add encoding=\"utf-8\" parameter to file operations")
        print()
        print("Examples:")
        print('  open(path, encoding="utf-8")')
        print('  Path(file).read_text(encoding="utf-8")')
        print('  Path(file).write_text(content, encoding="utf-8")')
        print()
        return 1

    if args.verbose:
        print(f"✅ All {len(files)} files pass encoding checks")

    return 0


if __name__ == "__main__":
    sys.exit(main())
