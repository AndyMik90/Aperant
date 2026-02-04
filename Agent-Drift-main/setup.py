#!/usr/bin/env python3
"""
Setup script for Agent Drift.
"""

from setuptools import setup, find_packages
from pathlib import Path

# Read README
readme_path = Path(__file__).parent / "README.md"
long_description = readme_path.read_text() if readme_path.exists() else ""

setup(
    name="agent-drift-detector",
    version="0.1.0",
    author="Buster",
    author_email="buster@openclaw.ai",
    description="Runtime behavioral monitoring for AI agents - detects silent compromise through behavioral drift analysis",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/openclaw/agent-drift-detector",
    packages=find_packages(),
    package_dir={"": "."},
    py_modules=["src"],
    python_requires=">=3.8",
    install_requires=[
        # No external dependencies - pure Python
    ],
    extras_require={
        "dev": [
            "pytest>=7.0",
            "pytest-cov>=4.0",
            "black>=23.0",
            "mypy>=1.0",
        ],
        "dashboard": [
            "flask>=2.0",
            "flask-socketio>=5.0",
            "python-socketio>=5.0",
        ],
        "all": [
            "pytest>=7.0",
            "pytest-cov>=4.0",
            "black>=23.0",
            "mypy>=1.0",
            "flask>=2.0",
            "flask-socketio>=5.0",
            "python-socketio>=5.0",
        ],
    },
    include_package_data=True,
    package_data={
        "src.dashboard": [
            "templates/*.html",
            "static/css/*.css",
            "static/js/*.js",
        ],
    },
    entry_points={
        "console_scripts": [
            "agent-drift=src.cli:main",
        ],
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Environment :: Console",
        "Intended Audience :: Developers",
        "Intended Audience :: System Administrators",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Security",
        "Topic :: System :: Monitoring",
        "Topic :: Software Development :: Testing",
    ],
    keywords="ai agents security monitoring drift detection behavioral analysis",
)
