"""
Stack Detection Module
======================

Detects programming languages, package managers, databases,
infrastructure tools, and cloud providers from project files.
"""

from pathlib import Path

from .config_parser import ConfigParser
from .models import TechnologyStack


class StackDetector:
    """Detects technology stack from project structure."""

    def __init__(self, project_dir: Path):
        """
        Initialize stack detector.

        Args:
            project_dir: Root directory of the project
        """
        self.project_dir = Path(project_dir).resolve()
        self.parser = ConfigParser(project_dir)
        self.stack = TechnologyStack()

    def detect_all(self) -> TechnologyStack:
        """
        Run all detection methods.

        Returns:
            TechnologyStack with all detected technologies
        """
        self.detect_languages()
        self.detect_package_managers()
        self.detect_databases()
        self.detect_infrastructure()
        self.detect_cloud_providers()
        self.detect_code_quality_tools()
        self.detect_version_managers()
        return self.stack

    def detect_languages(self) -> None:
        """Detect programming languages used."""
        # Python
        if self.parser.file_exists(
            "*.py",
            "**/*.py",
            "pyproject.toml",
            "requirements.txt",
            "setup.py",
            "Pipfile",
        ):
            self.stack.languages.append("python")

        # JavaScript
        if self.parser.file_exists("*.js", "**/*.js", "package.json"):
            self.stack.languages.append("javascript")

        # TypeScript
        if self.parser.file_exists(
            "*.ts", "*.tsx", "**/*.ts", "**/*.tsx", "tsconfig.json"
        ):
            self.stack.languages.append("typescript")

        # Rust
        if self.parser.file_exists("Cargo.toml", "*.rs", "**/*.rs"):
            self.stack.languages.append("rust")

        # Go
        if self.parser.file_exists("go.mod", "*.go", "**/*.go"):
            self.stack.languages.append("go")

        # Ruby
        if self.parser.file_exists("Gemfile", "*.rb", "**/*.rb"):
            self.stack.languages.append("ruby")

        # PHP
        if self.parser.file_exists("composer.json", "*.php", "**/*.php"):
            self.stack.languages.append("php")

        # Java
        if self.parser.file_exists("pom.xml", "build.gradle", "*.java", "**/*.java"):
            self.stack.languages.append("java")

        # Kotlin
        if self.parser.file_exists("*.kt", "**/*.kt"):
            self.stack.languages.append("kotlin")

        # Scala
        if self.parser.file_exists("build.sbt", "*.scala", "**/*.scala"):
            self.stack.languages.append("scala")

        # C#
        if self.parser.file_exists("*.csproj", "*.sln", "*.cs", "**/*.cs"):
            self.stack.languages.append("csharp")

        # C/C++
        if self.parser.file_exists(
            "*.c", "*.h", "**/*.c", "**/*.h", "CMakeLists.txt", "Makefile"
        ):
            self.stack.languages.append("c")
        if self.parser.file_exists("*.cpp", "*.hpp", "*.cc", "**/*.cpp", "**/*.hpp"):
            self.stack.languages.append("cpp")

        # Elixir
        if self.parser.file_exists("mix.exs", "*.ex", "**/*.ex"):
            self.stack.languages.append("elixir")

        # Swift
        if self.parser.file_exists("Package.swift", "*.swift", "**/*.swift"):
            self.stack.languages.append("swift")

        # Dart/Flutter
        if self.parser.file_exists("pubspec.yaml", "*.dart", "**/*.dart"):
            self.stack.languages.append("dart")

    def detect_package_managers(self) -> None:
        """Detect package managers used."""
        # Node.js package managers
        if self.parser.file_exists("package-lock.json"):
            self.stack.package_managers.append("npm")
        if self.parser.file_exists("yarn.lock"):
            self.stack.package_managers.append("yarn")
        if self.parser.file_exists("pnpm-lock.yaml"):
            self.stack.package_managers.append("pnpm")
        if self.parser.file_exists("bun.lockb", "bun.lock"):
            self.stack.package_managers.append("bun")
        if self.parser.file_exists("deno.json", "deno.jsonc"):
            self.stack.package_managers.append("deno")

        # Python package managers
        if self.parser.file_exists("requirements.txt", "requirements-dev.txt"):
            self.stack.package_managers.append("pip")
        if self.parser.file_exists("pyproject.toml"):
            toml = self.parser.read_toml("pyproject.toml")
            if toml:
                if "tool" in toml and "poetry" in toml["tool"]:
                    self.stack.package_managers.append("poetry")
                elif "project" in toml:
                    # Modern pyproject.toml - could be pip, uv, hatch, pdm
                    if self.parser.file_exists("uv.lock"):
                        self.stack.package_managers.append("uv")
                    elif self.parser.file_exists("pdm.lock"):
                        self.stack.package_managers.append("pdm")
                    else:
                        self.stack.package_managers.append("pip")
        if self.parser.file_exists("Pipfile"):
            self.stack.package_managers.append("pipenv")

        # Other package managers
        if self.parser.file_exists("Cargo.toml"):
            self.stack.package_managers.append("cargo")
        if self.parser.file_exists("go.mod"):
            self.stack.package_managers.append("go_mod")
        if self.parser.file_exists("Gemfile"):
            self.stack.package_managers.append("gem")
        if self.parser.file_exists("composer.json"):
            self.stack.package_managers.append("composer")
        if self.parser.file_exists("pom.xml"):
            self.stack.package_managers.append("maven")
        if self.parser.file_exists("build.gradle", "build.gradle.kts"):
            self.stack.package_managers.append("gradle")

        # Dart/Flutter package managers
        if self.parser.file_exists("pubspec.yaml", "pubspec.lock"):
            self.stack.package_managers.append("pub")
        if self.parser.file_exists("melos.yaml"):
            self.stack.package_managers.append("melos")

    def detect_databases(self) -> None:
        """Detect databases from config files and dependencies."""
        # Check for database config files
        if self.parser.file_exists(".env", ".env.local", ".env.development"):
            for env_file in [".env", ".env.local", ".env.development"]:
                content = self.parser.read_text(env_file)
                if content:
                    content_lower = content.lower()
                    if "postgres" in content_lower or "postgresql" in content_lower:
                        self.stack.databases.append("postgresql")
                    if "mysql" in content_lower:
                        self.stack.databases.append("mysql")
                    if "mongodb" in content_lower or "mongo_" in content_lower:
                        self.stack.databases.append("mongodb")
                    if "redis" in content_lower:
                        self.stack.databases.append("redis")
                    if "sqlite" in content_lower:
                        self.stack.databases.append("sqlite")

        # Check for Prisma schema
        if self.parser.file_exists("prisma/schema.prisma"):
            content = self.parser.read_text("prisma/schema.prisma")
            if content:
                content_lower = content.lower()
                if "postgresql" in content_lower:
                    self.stack.databases.append("postgresql")
                if "mysql" in content_lower:
                    self.stack.databases.append("mysql")
                if "mongodb" in content_lower:
                    self.stack.databases.append("mongodb")
                if "sqlite" in content_lower:
                    self.stack.databases.append("sqlite")

        # Check Docker Compose for database services
        for compose_file in [
            "docker-compose.yml",
            "docker-compose.yaml",
            "compose.yml",
            "compose.yaml",
        ]:
            content = self.parser.read_text(compose_file)
            if content:
                content_lower = content.lower()
                if "postgres" in content_lower:
                    self.stack.databases.append("postgresql")
                if "mysql" in content_lower or "mariadb" in content_lower:
                    self.stack.databases.append("mysql")
                if "mongo" in content_lower:
                    self.stack.databases.append("mongodb")
                if "redis" in content_lower:
                    self.stack.databases.append("redis")
                if "elasticsearch" in content_lower:
                    self.stack.databases.append("elasticsearch")

        # Deduplicate
        self.stack.databases = list(set(self.stack.databases))

    def detect_infrastructure(self) -> None:
        """Detect infrastructure tools."""
        # Docker
        if self.parser.file_exists(
            "Dockerfile", "docker-compose.yml", "docker-compose.yaml", ".dockerignore"
        ):
            self.stack.infrastructure.append("docker")

        # Podman
        if self.parser.file_exists("Containerfile"):
            self.stack.infrastructure.append("podman")

        # Kubernetes
        if self.parser.file_exists(
            "k8s/", "kubernetes/", "*.yaml"
        ) or self.parser.glob_files("**/deployment.yaml"):
            # Check if YAML files contain k8s resources
            for yaml_file in self.parser.glob_files(
                "**/*.yaml"
            ) + self.parser.glob_files("**/*.yml"):
                try:
                    with open(yaml_file, encoding="utf-8") as f:
                        content = f.read()
                        if "apiVersion:" in content and "kind:" in content:
                            self.stack.infrastructure.append("kubernetes")
                            break
                except OSError:
                    pass

        # Helm
        if self.parser.file_exists("Chart.yaml", "charts/"):
            self.stack.infrastructure.append("helm")

        # Terraform
        if self.parser.glob_files("**/*.tf"):
            self.stack.infrastructure.append("terraform")

        # Ansible
        if self.parser.file_exists("ansible.cfg", "playbook.yml", "playbooks/"):
            self.stack.infrastructure.append("ansible")

        # Vagrant
        if self.parser.file_exists("Vagrantfile"):
            self.stack.infrastructure.append("vagrant")

        # Minikube
        if self.parser.file_exists(".minikube/"):
            self.stack.infrastructure.append("minikube")

        # Deduplicate
        self.stack.infrastructure = list(set(self.stack.infrastructure))

    def detect_cloud_providers(self) -> None:
        """Detect cloud provider usage."""
        # AWS
        if self.parser.file_exists(
            "aws/",
            ".aws/",
            "serverless.yml",
            "sam.yaml",
            "template.yaml",
            "cdk.json",
            "amplify.yml",
        ):
            self.stack.cloud_providers.append("aws")

        # GCP
        if self.parser.file_exists(
            "app.yaml", ".gcloudignore", "firebase.json", ".firebaserc"
        ):
            self.stack.cloud_providers.append("gcp")

        # Azure
        if self.parser.file_exists("azure-pipelines.yml", ".azure/", "host.json"):
            self.stack.cloud_providers.append("azure")

        # Vercel
        if self.parser.file_exists("vercel.json", ".vercel/"):
            self.stack.cloud_providers.append("vercel")

        # Netlify
        if self.parser.file_exists("netlify.toml", "_redirects"):
            self.stack.cloud_providers.append("netlify")

        # Heroku
        if self.parser.file_exists("Procfile", "app.json"):
            self.stack.cloud_providers.append("heroku")

        # Railway
        if self.parser.file_exists("railway.json", "railway.toml"):
            self.stack.cloud_providers.append("railway")

        # Fly.io
        if self.parser.file_exists("fly.toml"):
            self.stack.cloud_providers.append("fly")

        # Cloudflare
        if self.parser.file_exists("wrangler.toml", "wrangler.json"):
            self.stack.cloud_providers.append("cloudflare")

        # Supabase
        if self.parser.file_exists("supabase/"):
            self.stack.cloud_providers.append("supabase")

    def detect_code_quality_tools(self) -> None:
        """Detect code quality tools from config files."""
        # Check for config files
        tool_configs = {
            ".shellcheckrc": "shellcheck",
            ".hadolint.yaml": "hadolint",
            ".yamllint": "yamllint",
            ".vale.ini": "vale",
            "cspell.json": "cspell",
            ".codespellrc": "codespell",
            ".semgrep.yml": "semgrep",
            ".snyk": "snyk",
            ".trivyignore": "trivy",
        }

        for config, tool in tool_configs.items():
            if self.parser.file_exists(config):
                self.stack.code_quality_tools.append(tool)

    def detect_version_managers(self) -> None:
        """Detect version managers."""
        if self.parser.file_exists(".tool-versions"):
            self.stack.version_managers.append("asdf")
        if self.parser.file_exists(".mise.toml", "mise.toml"):
            self.stack.version_managers.append("mise")
        if self.parser.file_exists(".nvmrc", ".node-version"):
            self.stack.version_managers.append("nvm")
        if self.parser.file_exists(".python-version"):
            self.stack.version_managers.append("pyenv")
        if self.parser.file_exists(".ruby-version"):
            self.stack.version_managers.append("rbenv")
        if self.parser.file_exists("rust-toolchain.toml", "rust-toolchain"):
            self.stack.version_managers.append("rustup")
        # Flutter Version Manager
        if self.parser.file_exists(".fvm", ".fvmrc", "fvm_config.json"):
            self.stack.version_managers.append("fvm")
