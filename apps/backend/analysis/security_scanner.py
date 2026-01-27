#!/usr/bin/env python3
"""
Security Scanner Module
=======================

Consolidates security scanning including secrets detection and SAST tools.
This module integrates the existing scan_secrets.py and provides a unified
interface for all security scanning.

The security scanner is used by:
- QA Agent: To verify no secrets are committed
- Validation Strategy: To run security scans for high-risk changes

Usage:
    from analysis.security_scanner import SecurityScanner

    scanner = SecurityScanner()
    results = scanner.scan(project_dir, spec_dir)

    if results.has_critical_issues:
        print("Security issues found - blocking QA approval")
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Import the existing secrets scanner
try:
    from security.scan_secrets import SecretMatch, get_all_tracked_files, scan_files

    HAS_SECRETS_SCANNER = True
except ImportError:
    HAS_SECRETS_SCANNER = False
    SecretMatch = None


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def _safe_exists(path: Path) -> bool:
    """
    Safely check if a path exists, handling PermissionError.

    On some systems, calling .exists() on deeply nested paths within
    non-existent directories can raise PermissionError instead of
    returning False. This wrapper handles that case.

    Args:
        path: Path to check

    Returns:
        True if path exists, False otherwise
    """
    try:
        return path.exists()
    except (PermissionError, OSError):
        return False


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class SecurityVulnerability:
    """
    Represents a security vulnerability found during scanning.

    Attributes:
        severity: Severity level (critical, high, medium, low, info)
        source: Which scanner found this (secrets, bandit, npm_audit, etc.)
        title: Short title of the vulnerability
        description: Detailed description
        file: File where vulnerability was found (if applicable)
        line: Line number (if applicable)
        cwe: CWE identifier if available
    """

    severity: str  # critical, high, medium, low, info
    source: str  # secrets, bandit, npm_audit, semgrep, etc.
    title: str
    description: str
    file: str | None = None
    line: int | None = None
    cwe: str | None = None


@dataclass
class SecurityScanResult:
    """
    Result of a security scan.

    Attributes:
        secrets: List of detected secrets
        vulnerabilities: List of security vulnerabilities
        scan_errors: List of errors during scanning
        has_critical_issues: Whether any critical issues were found
        should_block_qa: Whether these results should block QA approval
    """

    secrets: list[dict[str, Any]] = field(default_factory=list)
    vulnerabilities: list[SecurityVulnerability] = field(default_factory=list)
    scan_errors: list[str] = field(default_factory=list)
    has_critical_issues: bool = False
    should_block_qa: bool = False


# =============================================================================
# SECURITY SCANNER
# =============================================================================


class SecurityScanner:
    """
    Consolidates all security scanning operations.

    Integrates:
    - scan_secrets.py for secrets detection
    - Bandit for Python SAST (if available)
    - npm audit for JavaScript vulnerabilities (if applicable)
    """

    def __init__(self) -> None:
        """Initialize the security scanner."""
        self._bandit_available: bool | None = None
        self._npm_available: bool | None = None

    def scan(
        self,
        project_dir: Path,
        spec_dir: Path | None = None,
        changed_files: list[str] | None = None,
        run_secrets: bool = True,
        run_sast: bool = True,
        run_dependency_audit: bool = True,
    ) -> SecurityScanResult:
        """
        Run all applicable security scans.

        Args:
            project_dir: Path to the project root
            spec_dir: Path to the spec directory (for storing results)
            changed_files: Optional list of files to scan (if None, scans all)
            run_secrets: Whether to run secrets scanning
            run_sast: Whether to run SAST tools
            run_dependency_audit: Whether to run dependency audits

        Returns:
            SecurityScanResult with all findings
        """
        project_dir = Path(project_dir)
        result = SecurityScanResult()

        # Run secrets scan
        if run_secrets:
            self._run_secrets_scan(project_dir, changed_files, result)

        # Run SAST based on project type
        if run_sast:
            self._run_sast_scans(project_dir, result)

        # Run dependency audits
        if run_dependency_audit:
            self._run_dependency_audits(project_dir, result)

        # Determine if should block QA
        result.has_critical_issues = (
            any(v.severity in ["critical", "high"] for v in result.vulnerabilities)
            or len(result.secrets) > 0
        )

        # Any secrets always block, critical vulnerabilities block
        result.should_block_qa = len(result.secrets) > 0 or any(
            v.severity == "critical" for v in result.vulnerabilities
        )

        # Save results if spec_dir provided
        if spec_dir:
            self._save_results(spec_dir, result)

        return result

    def _run_secrets_scan(
        self,
        project_dir: Path,
        changed_files: list[str] | None,
        result: SecurityScanResult,
    ) -> None:
        """Run secrets scanning using scan_secrets.py."""
        if not HAS_SECRETS_SCANNER:
            result.scan_errors.append("scan_secrets module not available")
            return

        try:
            # Get files to scan
            if changed_files:
                files_to_scan = changed_files
            else:
                files_to_scan = get_all_tracked_files()

            # Run scan
            matches = scan_files(files_to_scan, project_dir)

            # Convert matches to result format
            for match in matches:
                result.secrets.append(
                    {
                        "file": match.file_path,
                        "line": match.line_number,
                        "pattern": match.pattern_name,
                        "matched_text": self._redact_secret(match.matched_text),
                    }
                )

                # Also add as vulnerability
                result.vulnerabilities.append(
                    SecurityVulnerability(
                        severity="critical",
                        source="secrets",
                        title=f"Potential secret: {match.pattern_name}",
                        description=f"Found potential {match.pattern_name} in file",
                        file=match.file_path,
                        line=match.line_number,
                    )
                )

        except Exception as e:
            result.scan_errors.append(f"Secrets scan error: {str(e)}")

    def _run_sast_scans(self, project_dir: Path, result: SecurityScanResult) -> None:
        """Run SAST tools based on project type."""
        # Python SAST with Bandit
        if self._is_python_project(project_dir):
            self._run_bandit(project_dir, result)

        # JavaScript/Node.js - npm audit
        # (handled in dependency audits for Node projects)

    def _run_bandit(self, project_dir: Path, result: SecurityScanResult) -> None:
        """Run Bandit security scanner for Python projects."""
        if not self._check_bandit_available():
            return

        try:
            # Find Python source directories
            src_dirs = []
            for candidate in ["src", "app", project_dir.name, "."]:
                candidate_path = project_dir / candidate
                if (
                    _safe_exists(candidate_path)
                    and _safe_exists(candidate_path / "__init__.py")
                ):
                    src_dirs.append(str(candidate_path))

            if not src_dirs:
                # Try to find any Python files
                py_files = list(project_dir.glob("**/*.py"))
                if not py_files:
                    return
                src_dirs = ["."]

            # Run bandit
            cmd = [
                "bandit",
                "-r",
                *src_dirs,
                "-f",
                "json",
                "--exit-zero",  # Don't fail on findings
            ]

            proc = subprocess.run(
                cmd,
                cwd=project_dir,
                capture_output=True,
                text=True,
                timeout=120,
            )

            if proc.stdout:
                try:
                    bandit_output = json.loads(proc.stdout)
                    for finding in bandit_output.get("results", []):
                        severity = finding.get("issue_severity", "MEDIUM").lower()
                        if severity == "high":
                            severity = "high"
                        elif severity == "medium":
                            severity = "medium"
                        else:
                            severity = "low"

                        result.vulnerabilities.append(
                            SecurityVulnerability(
                                severity=severity,
                                source="bandit",
                                title=finding.get("issue_text", "Unknown issue"),
                                description=finding.get("issue_text", ""),
                                file=finding.get("filename"),
                                line=finding.get("line_number"),
                                cwe=finding.get("issue_cwe", {}).get("id"),
                            )
                        )
                except json.JSONDecodeError:
                    result.scan_errors.append("Failed to parse Bandit output")

        except subprocess.TimeoutExpired:
            result.scan_errors.append("Bandit scan timed out")
        except FileNotFoundError:
            result.scan_errors.append("Bandit not found")
        except Exception as e:
            result.scan_errors.append(f"Bandit error: {str(e)}")

    def _run_dependency_audits(
        self, project_dir: Path, result: SecurityScanResult
    ) -> None:
        """Run dependency vulnerability audits."""
        # npm audit for JavaScript projects
        if _safe_exists(project_dir / "package.json"):
            self._run_npm_audit(project_dir, result)

        # pip-audit for Python projects (if available)
        if self._is_python_project(project_dir):
            self._run_pip_audit(project_dir, result)

    def _run_npm_audit(self, project_dir: Path, result: SecurityScanResult) -> None:
        """Run npm audit for JavaScript projects."""
        try:
            cmd = ["npm", "audit", "--json"]

            proc = subprocess.run(
                cmd,
                cwd=project_dir,
                capture_output=True,
                text=True,
                timeout=120,
            )

            if proc.stdout:
                try:
                    audit_output = json.loads(proc.stdout)

                    # npm audit v2+ format
                    vulnerabilities = audit_output.get("vulnerabilities", {})
                    for pkg_name, vuln_info in vulnerabilities.items():
                        severity = vuln_info.get("severity", "moderate")
                        if severity == "critical":
                            severity = "critical"
                        elif severity == "high":
                            severity = "high"
                        elif severity == "moderate":
                            severity = "medium"
                        else:
                            severity = "low"

                        result.vulnerabilities.append(
                            SecurityVulnerability(
                                severity=severity,
                                source="npm_audit",
                                title=f"Vulnerable dependency: {pkg_name}",
                                description=vuln_info.get("via", [{}])[0].get(
                                    "title", ""
                                )
                                if isinstance(vuln_info.get("via"), list)
                                and vuln_info.get("via")
                                else str(vuln_info.get("via", "")),
                                file="package.json",
                            )
                        )
                except json.JSONDecodeError:
                    pass  # npm audit may return invalid JSON on no findings

        except subprocess.TimeoutExpired:
            result.scan_errors.append("npm audit timed out")
        except FileNotFoundError:
            pass  # npm not available
        except Exception as e:
            result.scan_errors.append(f"npm audit error: {str(e)}")

    def _run_pip_audit(self, project_dir: Path, result: SecurityScanResult) -> None:
        """Run pip-audit for Python projects (if available)."""
        try:
            cmd = ["pip-audit", "--format", "json"]

            proc = subprocess.run(
                cmd,
                cwd=project_dir,
                capture_output=True,
                text=True,
                timeout=120,
            )

            if proc.stdout:
                try:
                    audit_output = json.loads(proc.stdout)
                    for vuln in audit_output:
                        severity = "high" if vuln.get("fix_versions") else "medium"

                        result.vulnerabilities.append(
                            SecurityVulnerability(
                                severity=severity,
                                source="pip_audit",
                                title=f"Vulnerable package: {vuln.get('name')}",
                                description=vuln.get("description", ""),
                                cwe=vuln.get("aliases", [""])[0]
                                if vuln.get("aliases")
                                else None,
                            )
                        )
                except json.JSONDecodeError:
                    pass

        except FileNotFoundError:
            pass  # pip-audit not available
        except subprocess.TimeoutExpired:
            pass
        except Exception:
            pass

    def _is_python_project(self, project_dir: Path) -> bool:
        """Check if this is a Python project."""
        indicators = [
            project_dir / "pyproject.toml",
            project_dir / "requirements.txt",
            project_dir / "setup.py",
            project_dir / "setup.cfg",
        ]
        return any(_safe_exists(p) for p in indicators)

    def _check_bandit_available(self) -> bool:
        """Check if Bandit is available."""
        if self._bandit_available is None:
            try:
                subprocess.run(
                    ["bandit", "--version"],
                    capture_output=True,
                    timeout=5,
                )
                self._bandit_available = True
            except (FileNotFoundError, subprocess.TimeoutExpired):
                self._bandit_available = False
        return self._bandit_available

    def _redact_secret(self, text: str) -> str:
        """Redact a secret for safe logging."""
        if len(text) <= 8:
            return "*" * len(text)
        return text[:4] + "*" * (len(text) - 8) + text[-4:]

    def _save_results(self, spec_dir: Path, result: SecurityScanResult) -> None:
        """Save scan results to spec directory."""
        spec_dir = Path(spec_dir)
        spec_dir.mkdir(parents=True, exist_ok=True)

        output_file = spec_dir / "security_scan_results.json"
        output_data = self.to_dict(result)

        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=2)

    def to_dict(self, result: SecurityScanResult) -> dict[str, Any]:
        """Convert result to dictionary for JSON serialization."""
        return {
            "secrets": result.secrets,
            "vulnerabilities": [
                {
                    "severity": v.severity,
                    "source": v.source,
                    "title": v.title,
                    "description": v.description,
                    "file": v.file,
                    "line": v.line,
                    "cwe": v.cwe,
                }
                for v in result.vulnerabilities
            ],
            "scan_errors": result.scan_errors,
            "has_critical_issues": result.has_critical_issues,
            "should_block_qa": result.should_block_qa,
            "summary": {
                "total_secrets": len(result.secrets),
                "total_vulnerabilities": len(result.vulnerabilities),
                "critical_count": sum(
                    1 for v in result.vulnerabilities if v.severity == "critical"
                ),
                "high_count": sum(
                    1 for v in result.vulnerabilities if v.severity == "high"
                ),
                "medium_count": sum(
                    1 for v in result.vulnerabilities if v.severity == "medium"
                ),
                "low_count": sum(
                    1 for v in result.vulnerabilities if v.severity == "low"
                ),
            },
        }


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================


def scan_for_security_issues(
    project_dir: Path,
    spec_dir: Path | None = None,
    changed_files: list[str] | None = None,
) -> SecurityScanResult:
    """
    Convenience function to run security scan.

    Args:
        project_dir: Path to project root
        spec_dir: Optional spec directory to save results
        changed_files: Optional list of files to scan

    Returns:
        SecurityScanResult with all findings
    """
    scanner = SecurityScanner()
    return scanner.scan(project_dir, spec_dir, changed_files)


def has_security_issues(project_dir: Path) -> bool:
    """
    Quick check if project has security issues.

    Args:
        project_dir: Path to project root

    Returns:
        True if any critical/high issues found
    """
    scanner = SecurityScanner()
    result = scanner.scan(project_dir, run_sast=False, run_dependency_audit=False)
    return result.has_critical_issues


def scan_secrets_only(
    project_dir: Path,
    changed_files: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Scan only for secrets (quick scan).

    Args:
        project_dir: Path to project root
        changed_files: Optional list of files to scan

    Returns:
        List of detected secrets
    """
    scanner = SecurityScanner()
    result = scanner.scan(
        project_dir,
        changed_files=changed_files,
        run_sast=False,
        run_dependency_audit=False,
    )
    return result.secrets


# =============================================================================
# CLI
# =============================================================================


def main() -> None:
    """CLI entry point for testing."""
    import argparse

    parser = argparse.ArgumentParser(description="Run security scans")
    parser.add_argument("project_dir", type=Path, help="Path to project root")
    parser.add_argument("--spec-dir", type=Path, help="Path to spec directory")
    parser.add_argument(
        "--secrets-only", action="store_true", help="Only scan for secrets"
    )
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    scanner = SecurityScanner()
    result = scanner.scan(
        args.project_dir,
        spec_dir=args.spec_dir,
        run_sast=not args.secrets_only,
        run_dependency_audit=not args.secrets_only,
    )

    if args.json:
        print(json.dumps(scanner.to_dict(result), indent=2))
    else:
        print(f"Secrets Found: {len(result.secrets)}")
        print(f"Vulnerabilities: {len(result.vulnerabilities)}")
        print(f"Has Critical Issues: {result.has_critical_issues}")
        print(f"Should Block QA: {result.should_block_qa}")

        if result.secrets:
            print("\nSecrets Detected:")
            for secret in result.secrets:
                print(f"  - {secret['pattern']} in {secret['file']}:{secret['line']}")

        if result.vulnerabilities:
            print(f"\nVulnerabilities ({len(result.vulnerabilities)}):")
            for v in result.vulnerabilities:
                print(f"  [{v.severity.upper()}] {v.title}")
                if v.file:
                    print(f"    File: {v.file}:{v.line or ''}")

        if result.scan_errors:
            print(f"\nScan Errors ({len(result.scan_errors)}):")
            for error in result.scan_errors:
                print(f"  - {error}")


if __name__ == "__main__":
    main()
