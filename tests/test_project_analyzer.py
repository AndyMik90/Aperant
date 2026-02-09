#!/usr/bin/env python3
"""
Tests for Project Analyzer
==========================

Tests the project_analyzer.py module functionality including:
- Technology stack detection (languages, frameworks, databases)
- Package manager detection
- Infrastructure detection
- Security profile generation
- Custom scripts detection
- Profile caching
"""

import json
from pathlib import Path

from project_analyzer import (
    BASE_COMMANDS,
    CustomScripts,
    ProjectAnalyzer,
    SecurityProfile,
    TechnologyStack,
    get_or_create_profile,
    is_command_allowed,
    needs_validation,
)


class TestProjectAnalyzerInitialization:
    """Tests for ProjectAnalyzer initialization."""

    def test_init_with_project_dir(self, temp_dir: Path):
        """Initializes with project directory."""
        analyzer = ProjectAnalyzer(temp_dir)

        assert analyzer.project_dir == temp_dir.resolve()
        assert analyzer.spec_dir is None

    def test_init_with_spec_dir(self, temp_dir: Path, spec_dir: Path):
        """Initializes with spec directory."""
        analyzer = ProjectAnalyzer(temp_dir, spec_dir)

        assert analyzer.spec_dir == spec_dir.resolve()

    def test_get_profile_path_without_spec(self, temp_dir: Path):
        """Profile path is in project dir when no spec dir."""
        analyzer = ProjectAnalyzer(temp_dir)

        path = analyzer.get_profile_path()
        # Use resolve() to handle /var -> /private/var symlinks on macOS
        assert path.resolve() == (temp_dir / ".ac-jerry-security.json").resolve()

    def test_get_profile_path_with_spec(self, temp_dir: Path, spec_dir: Path):
        """Profile path is in spec dir when provided."""
        analyzer = ProjectAnalyzer(temp_dir, spec_dir)

        path = analyzer.get_profile_path()
        # Use resolve() to handle /var -> /private/var symlinks on macOS
        assert path.resolve() == (spec_dir / ".ac-jerry-security.json").resolve()


class TestLanguageDetection:
    """Tests for programming language detection."""

    def test_detects_python(self, temp_dir: Path):
        """Detects Python projects."""
        (temp_dir / "app.py").write_text("print('hello')")
        (temp_dir / "requirements.txt").write_text("flask\n")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_languages()

        assert "python" in analyzer.profile.detected_stack.languages

    def test_detects_javascript(self, temp_dir: Path):
        """Detects JavaScript projects."""
        (temp_dir / "package.json").write_text('{"name": "test"}')
        (temp_dir / "index.js").write_text("console.log('hello');")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_languages()

        assert "javascript" in analyzer.profile.detected_stack.languages

    def test_detects_typescript(self, temp_dir: Path):
        """Detects TypeScript projects."""
        (temp_dir / "tsconfig.json").write_text("{}")
        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "index.ts").write_text("export const x = 1;")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_languages()

        assert "typescript" in analyzer.profile.detected_stack.languages

    def test_detects_rust(self, temp_dir: Path):
        """Detects Rust projects."""
        (temp_dir / "Cargo.toml").write_text('[package]\nname = "test"')
        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "main.rs").write_text("fn main() {}")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_languages()

        assert "rust" in analyzer.profile.detected_stack.languages

    def test_detects_go(self, temp_dir: Path):
        """Detects Go projects."""
        (temp_dir / "go.mod").write_text("module test")
        (temp_dir / "main.go").write_text("package main")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_languages()

        assert "go" in analyzer.profile.detected_stack.languages

    def test_detects_multiple_languages(self, temp_dir: Path):
        """Detects multiple languages in same project."""
        (temp_dir / "app.py").write_text("print('hello')")
        (temp_dir / "package.json").write_text('{"name": "test"}')

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_languages()

        assert "python" in analyzer.profile.detected_stack.languages
        assert "javascript" in analyzer.profile.detected_stack.languages


class TestPackageManagerDetection:
    """Tests for package manager detection."""

    def test_detects_npm(self, temp_dir: Path):
        """Detects npm from package-lock.json."""
        (temp_dir / "package.json").write_text('{"name": "test"}')
        (temp_dir / "package-lock.json").write_text("{}")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_package_managers()

        assert "npm" in analyzer.profile.detected_stack.package_managers

    def test_detects_yarn(self, temp_dir: Path):
        """Detects yarn from yarn.lock."""
        (temp_dir / "package.json").write_text('{"name": "test"}')
        (temp_dir / "yarn.lock").write_text("")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_package_managers()

        assert "yarn" in analyzer.profile.detected_stack.package_managers

    def test_detects_pnpm(self, temp_dir: Path):
        """Detects pnpm from pnpm-lock.yaml."""
        (temp_dir / "package.json").write_text('{"name": "test"}')
        (temp_dir / "pnpm-lock.yaml").write_text("")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_package_managers()

        assert "pnpm" in analyzer.profile.detected_stack.package_managers

    def test_detects_pip(self, temp_dir: Path):
        """Detects pip from requirements.txt."""
        (temp_dir / "requirements.txt").write_text("flask\n")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_package_managers()

        assert "pip" in analyzer.profile.detected_stack.package_managers

    def test_detects_poetry(self, temp_dir: Path):
        """Detects poetry from pyproject.toml."""
        pyproject = """[tool.poetry]
name = "test"
version = "0.1.0"
"""
        (temp_dir / "pyproject.toml").write_text(pyproject)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_package_managers()

        assert "poetry" in analyzer.profile.detected_stack.package_managers

    def test_detects_cargo(self, temp_dir: Path):
        """Detects cargo from Cargo.toml."""
        (temp_dir / "Cargo.toml").write_text('[package]\nname = "test"')

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_package_managers()

        assert "cargo" in analyzer.profile.detected_stack.package_managers


class TestFrameworkDetection:
    """Tests for framework detection."""

    def test_detects_nextjs(self, temp_dir: Path):
        """Detects Next.js framework."""
        pkg = {"dependencies": {"next": "^14.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_frameworks()

        assert "nextjs" in analyzer.profile.detected_stack.frameworks

    def test_detects_react(self, temp_dir: Path):
        """Detects React framework."""
        pkg = {"dependencies": {"react": "^18.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_frameworks()

        assert "react" in analyzer.profile.detected_stack.frameworks

    def test_detects_flask(self, temp_dir: Path):
        """Detects Flask framework from pyproject.toml."""
        pyproject = """[project]
name = "test"
dependencies = ["flask>=2.0"]
"""
        (temp_dir / "pyproject.toml").write_text(pyproject)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_frameworks()

        assert "flask" in analyzer.profile.detected_stack.frameworks

    def test_detects_flask_from_requirements(self, temp_dir: Path):
        """Detects Flask framework from requirements.txt."""
        (temp_dir / "requirements.txt").write_text("flask>=2.0\npytest\n")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_frameworks()

        assert "flask" in analyzer.profile.detected_stack.frameworks

    def test_detects_prisma(self, temp_dir: Path):
        """Detects Prisma ORM."""
        pkg = {"dependencies": {"prisma": "^5.0.0"}}
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_frameworks()

        assert "prisma" in analyzer.profile.detected_stack.frameworks

    def test_detects_pytest(self, temp_dir: Path):
        """Detects pytest framework."""
        (temp_dir / "requirements.txt").write_text("pytest>=7.0\n")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_frameworks()

        assert "pytest" in analyzer.profile.detected_stack.frameworks


class TestDatabaseDetection:
    """Tests for database detection."""

    def test_detects_postgres_from_env(self, temp_dir: Path):
        """Detects PostgreSQL from .env file."""
        (temp_dir / ".env").write_text("DATABASE_URL=postgresql://localhost/test\n")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_databases()

        assert "postgresql" in analyzer.profile.detected_stack.databases

    def test_detects_mongodb_from_env(self, temp_dir: Path):
        """Detects MongoDB from .env file."""
        (temp_dir / ".env").write_text("MONGODB_URI=mongodb://localhost/test\n")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_databases()

        assert "mongodb" in analyzer.profile.detected_stack.databases

    def test_detects_redis_from_docker_compose(self, temp_dir: Path):
        """Detects Redis from docker-compose.yml."""
        compose = """services:
  redis:
    image: redis:7
"""
        (temp_dir / "docker-compose.yml").write_text(compose)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_databases()

        assert "redis" in analyzer.profile.detected_stack.databases

    def test_detects_postgres_from_prisma(self, temp_dir: Path):
        """Detects PostgreSQL from Prisma schema."""
        (temp_dir / "prisma").mkdir()
        schema = """datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}
"""
        (temp_dir / "prisma" / "schema.prisma").write_text(schema)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_databases()

        assert "postgresql" in analyzer.profile.detected_stack.databases


class TestInfrastructureDetection:
    """Tests for infrastructure detection."""

    def test_detects_docker(self, temp_dir: Path):
        """Detects Docker from Dockerfile."""
        (temp_dir / "Dockerfile").write_text("FROM python:3.11")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_infrastructure()

        assert "docker" in analyzer.profile.detected_stack.infrastructure

    def test_detects_docker_compose(self, temp_dir: Path):
        """Detects Docker from docker-compose.yml."""
        (temp_dir / "docker-compose.yml").write_text("services:\n  app:\n    build: .")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_infrastructure()

        assert "docker" in analyzer.profile.detected_stack.infrastructure

    def test_detects_terraform(self, temp_dir: Path):
        """Detects Terraform from .tf files."""
        (temp_dir / "infra").mkdir()
        (temp_dir / "infra" / "main.tf").write_text('resource "aws_instance" "web" {}')

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_infrastructure()

        assert "terraform" in analyzer.profile.detected_stack.infrastructure

    def test_detects_helm(self, temp_dir: Path):
        """Detects Helm from Chart.yaml."""
        (temp_dir / "Chart.yaml").write_text("name: myapp\nversion: 1.0.0")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_infrastructure()

        assert "helm" in analyzer.profile.detected_stack.infrastructure


class TestCloudProviderDetection:
    """Tests for cloud provider detection."""

    def test_detects_vercel(self, temp_dir: Path):
        """Detects Vercel from vercel.json."""
        (temp_dir / "vercel.json").write_text('{"buildCommand": "npm run build"}')

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_cloud_providers()

        assert "vercel" in analyzer.profile.detected_stack.cloud_providers

    def test_detects_netlify(self, temp_dir: Path):
        """Detects Netlify from netlify.toml."""
        (temp_dir / "netlify.toml").write_text('[build]\ncommand = "npm run build"')

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_cloud_providers()

        assert "netlify" in analyzer.profile.detected_stack.cloud_providers

    def test_detects_fly(self, temp_dir: Path):
        """Detects Fly.io from fly.toml."""
        (temp_dir / "fly.toml").write_text('app = "myapp"')

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_cloud_providers()

        assert "fly" in analyzer.profile.detected_stack.cloud_providers


class TestCustomScriptDetection:
    """Tests for custom script detection."""

    def test_detects_npm_scripts(self, temp_dir: Path):
        """Detects npm scripts from package.json."""
        pkg = {
            "scripts": {
                "dev": "next dev",
                "build": "next build",
                "test": "jest",
            }
        }
        (temp_dir / "package.json").write_text(json.dumps(pkg))

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_custom_scripts()

        assert "dev" in analyzer.profile.custom_scripts.npm_scripts
        assert "build" in analyzer.profile.custom_scripts.npm_scripts
        assert "test" in analyzer.profile.custom_scripts.npm_scripts

    def test_detects_makefile_targets(self, temp_dir: Path):
        """Detects Makefile targets."""
        makefile = """build:
\tgo build

test:
\tgo test ./...

.PHONY: build test
"""
        (temp_dir / "Makefile").write_text(makefile)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_custom_scripts()

        assert "build" in analyzer.profile.custom_scripts.make_targets
        assert "test" in analyzer.profile.custom_scripts.make_targets

    def test_detects_shell_scripts(self, temp_dir: Path):
        """Detects shell scripts in root."""
        (temp_dir / "setup.sh").write_text("#!/bin/bash\necho 'setup'")
        (temp_dir / "deploy.sh").write_text("#!/bin/bash\necho 'deploy'")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_custom_scripts()

        assert "setup.sh" in analyzer.profile.custom_scripts.shell_scripts
        assert "deploy.sh" in analyzer.profile.custom_scripts.shell_scripts


class TestCustomAllowlist:
    """Tests for custom allowlist loading."""

    def test_loads_custom_allowlist(self, temp_dir: Path):
        """Loads commands from .ac-jerry-allowlist."""
        allowlist = """# Custom commands
my-custom-tool
another-command
"""
        (temp_dir / ".ac-jerry-allowlist").write_text(allowlist)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._load_custom_allowlist()

        assert "my-custom-tool" in analyzer.profile.custom_commands
        assert "another-command" in analyzer.profile.custom_commands


class TestSecurityProfileGeneration:
    """Tests for complete security profile generation."""

    def test_full_analysis(self, python_project: Path):
        """Full analysis generates complete profile."""
        profile = get_or_create_profile(python_project)

        # Base commands always included
        assert len(profile.base_commands) > 0
        assert "ls" in profile.base_commands
        assert "git" in profile.base_commands

        # Stack commands based on detected technologies
        assert "python" in profile.stack_commands
        assert "pip" in profile.stack_commands

    def test_profile_caching(self, python_project: Path):
        """Profile is cached after first analysis."""
        # First analysis
        profile1 = get_or_create_profile(python_project)
        profile_path = python_project / ".ac-jerry-security.json"

        assert profile_path.exists()

        # Second call should use cache
        profile2 = get_or_create_profile(python_project)

        assert profile1.project_hash == profile2.project_hash

    def test_force_reanalyze(self, python_project: Path):
        """Force flag triggers re-analysis."""
        profile1 = get_or_create_profile(python_project)
        created1 = profile1.created_at

        # Force re-analysis
        import time

        time.sleep(0.1)  # Ensure different timestamp
        profile2 = get_or_create_profile(python_project, force_reanalyze=True)

        # Should have different creation timestamp
        assert profile2.created_at != created1


class TestCommandAllowlistChecking:
    """Tests for command allowlist checking."""

    def test_base_command_allowed(self):
        """Base commands are always allowed."""
        profile = SecurityProfile()
        profile.base_commands = BASE_COMMANDS.copy()

        allowed, reason = is_command_allowed("ls", profile)
        assert allowed is True

    def test_stack_command_allowed(self):
        """Stack commands are allowed when detected."""
        profile = SecurityProfile()
        profile.stack_commands = {"python", "pip"}

        allowed, reason = is_command_allowed("python", profile)
        assert allowed is True

    def test_unknown_command_blocked(self):
        """Unknown commands are blocked."""
        profile = SecurityProfile()
        profile.base_commands = {"ls", "cat"}

        allowed, reason = is_command_allowed("dangerous_cmd", profile)
        assert allowed is False
        assert "not in the allowed commands" in reason

    def test_custom_command_allowed(self):
        """Custom commands from allowlist are allowed."""
        profile = SecurityProfile()
        profile.custom_commands = {"my-tool"}

        allowed, reason = is_command_allowed("my-tool", profile)
        assert allowed is True


class TestValidatedCommands:
    """Tests for commands that need extra validation."""

    def test_rm_needs_validation(self):
        """rm command needs validation."""
        validator = needs_validation("rm")
        assert validator == "validate_rm"

    def test_chmod_needs_validation(self):
        """chmod command needs validation."""
        validator = needs_validation("chmod")
        assert validator == "validate_chmod"

    def test_pkill_needs_validation(self):
        """pkill command needs validation."""
        validator = needs_validation("pkill")
        assert validator == "validate_pkill"

    def test_normal_command_no_validation(self):
        """Normal commands don't need extra validation."""
        validator = needs_validation("ls")
        assert validator is None


class TestSecurityProfileSerialization:
    """Tests for SecurityProfile serialization."""

    def test_to_dict(self):
        """Profile converts to dict correctly."""
        profile = SecurityProfile()
        profile.base_commands = {"ls", "cat"}
        profile.stack_commands = {"python", "pip"}
        profile.detected_stack.languages = ["python"]
        profile.project_hash = "abc123"

        data = profile.to_dict()

        assert "ls" in data["base_commands"]
        assert "python" in data["stack_commands"]
        assert "python" in data["detected_stack"]["languages"]
        assert data["project_hash"] == "abc123"

    def test_from_dict(self):
        """Profile loads from dict correctly."""
        data = {
            "base_commands": ["ls", "cat"],
            "stack_commands": ["python"],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": ["python"],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": [],
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": [],
            },
            "project_dir": "/test",
            "created_at": "2024-01-01",
            "project_hash": "abc123",
        }

        profile = SecurityProfile.from_dict(data)

        assert "ls" in profile.base_commands
        assert "python" in profile.stack_commands
        assert "python" in profile.detected_stack.languages
        assert profile.project_hash == "abc123"

    def test_save_and_load(self, temp_dir: Path):
        """Profile saves and loads correctly."""
        analyzer = ProjectAnalyzer(temp_dir)
        profile = SecurityProfile()
        profile.base_commands = {"ls", "cat"}
        profile.stack_commands = {"python"}
        profile.project_hash = "test123"

        # Save
        analyzer.save_profile(profile)

        # Load
        loaded = analyzer.load_profile()

        assert loaded is not None
        assert "ls" in loaded.base_commands
        assert "python" in loaded.stack_commands
        assert loaded.project_hash == "test123"


class TestDartFlutterDetection:
    """Tests for Dart/Flutter language and framework detection."""

    def test_detects_dart_language(self, temp_dir: Path):
        """Detects Dart from pubspec.yaml."""
        pubspec = """name: my_app
version: 1.0.0
environment:
  sdk: ">=3.0.0 <4.0.0"
"""
        (temp_dir / "pubspec.yaml").write_text(pubspec)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_languages()

        assert "dart" in analyzer.profile.detected_stack.languages

    def test_detects_dart_from_files(self, temp_dir: Path):
        """Detects Dart from .dart files."""
        (temp_dir / "lib").mkdir()
        (temp_dir / "lib" / "main.dart").write_text("void main() {}")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_languages()

        assert "dart" in analyzer.profile.detected_stack.languages

    def test_detects_flutter_framework(self, temp_dir: Path):
        """Detects Flutter framework from pubspec.yaml."""
        pubspec = """name: my_flutter_app
version: 1.0.0
environment:
  sdk: ">=3.0.0 <4.0.0"
  flutter: ">=3.0.0"

dependencies:
  flutter:
    sdk: flutter
"""
        (temp_dir / "pubspec.yaml").write_text(pubspec)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_frameworks()

        assert "flutter" in analyzer.profile.detected_stack.frameworks

    def test_detects_pub_package_manager(self, temp_dir: Path):
        """Detects pub package manager from pubspec.yaml."""
        pubspec = """name: my_app
version: 1.0.0
"""
        (temp_dir / "pubspec.yaml").write_text(pubspec)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_package_managers()

        assert "pub" in analyzer.profile.detected_stack.package_managers

    def test_detects_pub_from_lock_file(self, temp_dir: Path):
        """Detects pub package manager from pubspec.lock."""
        (temp_dir / "pubspec.lock").write_text("packages:\n")

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_package_managers()

        assert "pub" in analyzer.profile.detected_stack.package_managers


class TestMelosMonorepoDetection:
    """Tests for Melos monorepo tool detection."""

    def test_detects_melos_from_config(self, temp_dir: Path):
        """Detects Melos from melos.yaml."""
        melos_config = """name: my_workspace
packages:
  - packages/*
"""
        (temp_dir / "melos.yaml").write_text(melos_config)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_package_managers()

        assert "melos" in analyzer.profile.detected_stack.package_managers

    def test_melos_commands_allowed(self, temp_dir: Path):
        """Melos commands are allowed when detected."""
        melos_config = """name: my_workspace
packages:
  - packages/*
"""
        (temp_dir / "melos.yaml").write_text(melos_config)

        profile = get_or_create_profile(temp_dir, force_reanalyze=True)

        assert "melos" in profile.stack_commands


class TestFvmVersionManagerDetection:
    """Tests for Flutter Version Manager (FVM) detection."""

    def test_detects_fvm_from_directory(self, temp_dir: Path):
        """Detects FVM from .fvm directory."""
        (temp_dir / ".fvm").mkdir()

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_version_managers()

        assert "fvm" in analyzer.profile.detected_stack.version_managers

    def test_detects_fvm_from_config(self, temp_dir: Path):
        """Detects FVM from fvm_config.json."""
        fvm_config = '{"flutterSdkVersion": "3.19.0"}'
        (temp_dir / "fvm_config.json").write_text(fvm_config)

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_version_managers()

        assert "fvm" in analyzer.profile.detected_stack.version_managers

    def test_detects_fvm_from_fvmrc(self, temp_dir: Path):
        """Detects FVM from .fvmrc file."""
        (temp_dir / ".fvmrc").write_text('{"flutter": "3.19.0"}')

        analyzer = ProjectAnalyzer(temp_dir)
        analyzer._detect_version_managers()

        assert "fvm" in analyzer.profile.detected_stack.version_managers

    def test_fvm_commands_allowed(self, temp_dir: Path):
        """FVM commands are allowed when detected."""
        (temp_dir / ".fvm").mkdir()

        profile = get_or_create_profile(temp_dir, force_reanalyze=True)

        assert "fvm" in profile.stack_commands


class TestDartFlutterCommandsAllowed:
    """Tests that Dart/Flutter commands are properly allowed."""

    def test_dart_commands_allowed_for_dart_project(self, temp_dir: Path):
        """Dart commands are allowed when Dart is detected."""
        pubspec = """name: my_app
version: 1.0.0
"""
        (temp_dir / "pubspec.yaml").write_text(pubspec)

        profile = get_or_create_profile(temp_dir, force_reanalyze=True)

        # Core Dart commands
        assert "dart" in profile.stack_commands
        assert "pub" in profile.stack_commands
        # Flutter should be available for Dart projects
        assert "flutter" in profile.stack_commands

    def test_flutter_commands_allowed_for_flutter_project(self, temp_dir: Path):
        """Flutter commands are allowed when Flutter is detected."""
        pubspec = """name: my_flutter_app
version: 1.0.0
dependencies:
  flutter:
    sdk: flutter
"""
        (temp_dir / "pubspec.yaml").write_text(pubspec)

        profile = get_or_create_profile(temp_dir, force_reanalyze=True)

        assert "flutter" in profile.stack_commands
        assert "dart" in profile.stack_commands
        assert "pub" in profile.stack_commands
