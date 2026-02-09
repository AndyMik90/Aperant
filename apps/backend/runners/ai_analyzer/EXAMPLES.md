# AI Analyzer Usage Examples

## Command Line Interface

### Basic Usage

```bash
# Run full analysis on current directory
python ai_analyzer_runner.py

# Analyze specific project
python ai_analyzer_runner.py --project-dir /path/to/project

# Run only security and performance analyzers
python ai_analyzer_runner.py --analyzers security performance

# Force fresh analysis (skip cache)
python ai_analyzer_runner.py --skip-cache

# Use custom programmatic analysis file
python ai_analyzer_runner.py --index custom_analysis.json
```

## Python API

### Basic Analysis

```python
import asyncio
import json
from pathlib import Path
from ai_analyzer import AIAnalyzerRunner

# Load project index from programmatic analyzer
project_dir = Path("/path/to/project")
index_file = project_dir / "comprehensive_analysis.json"
project_index = json.loads(index_file.read_text())

# Create runner
runner = AIAnalyzerRunner(project_dir, project_index)

# Run full analysis
insights = asyncio.run(runner.run_full_analysis())

# Print formatted summary
runner.print_summary(insights)
```

### Selective Analysis

```python
# Run only specific analyzers
selected = ["security", "performance"]
insights = asyncio.run(
    runner.run_full_analysis(selected_analyzers=selected)
)

# Access specific results
security_score = insights["security"]["score"]
vulnerabilities = insights["security"]["vulnerabilities"]

for vuln in vulnerabilities:
    print(f"[{vuln['severity']}] {vuln['type']}")
    print(f"Location: {vuln['location']}")
    print(f"Fix: {vuln['recommendation']}\n")
```

### Cost Estimation Only

```python
from ai_analyzer.cost_estimator import CostEstimator

# Get cost estimate without running analysis
estimator = CostEstimator(project_dir, project_index)
cost = estimator.estimate_cost()

print(f"Estimated tokens: {cost.estimated_tokens:,}")
print(f"Estimated cost: ${cost.estimated_cost_usd:.4f}")
print(f"Files to analyze: {cost.files_to_analyze}")
```

### Working with Cache

```python
from pathlib import Path
from ai_analyzer.cache_manager import CacheManager

# Create cache manager
cache_dir = project_dir / ".ac-jerry" / "ai_cache"
cache = CacheManager(cache_dir)

# Check for cached results
cached = cache.get_cached_result()
if cached:
    print("Using cached analysis")
    insights = cached
else:
    print("Running fresh analysis")
    insights = asyncio.run(runner.run_full_analysis())
    cache.save_result(insights)
```

### Custom Analysis with Claude Client

```python
from ai_analyzer.claude_client import ClaudeAnalysisClient

# Create client for custom queries
client = ClaudeAnalysisClient(project_dir)

# Run custom analysis
custom_prompt = """
Analyze the error handling patterns in this codebase.
Identify any missing try-catch blocks or unhandled exceptions.
Output as JSON with locations and recommendations.
"""

result = asyncio.run(client.run_analysis_query(custom_prompt))
print(result)
```

### Using Individual Analyzers

```python
from ai_analyzer.analyzers import (
    AnalyzerFactory,
    SecurityAnalyzer,
    PerformanceAnalyzer
)
from ai_analyzer.claude_client import ClaudeAnalysisClient
from ai_analyzer.result_parser import ResultParser

# Create analyzer using factory
analyzer = AnalyzerFactory.create("security", project_index)

# Or create directly
analyzer = SecurityAnalyzer(project_index)

# Get the analysis prompt
prompt = analyzer.get_prompt()

# Run analysis with Claude
client = ClaudeAnalysisClient(project_dir)
response = asyncio.run(client.run_analysis_query(prompt))

# Parse result
parser = ResultParser()
result = parser.parse_json_response(response, analyzer.get_default_result())

print(f"Security Score: {result['score']}/100")
print(f"Vulnerabilities: {len(result['vulnerabilities'])}")
```

### Creating Custom Analyzers

```python
from typing import Any
from ai_analyzer.analyzers import BaseAnalyzer, AnalyzerFactory

class CustomAnalyzer(BaseAnalyzer):
    """Custom analyzer for specific analysis needs."""

    def get_prompt(self) -> str:
        """Generate analysis prompt."""
        return """
        Analyze the API versioning strategy in this codebase.

        Check for:
        1. Version numbering in URLs
        2. API version headers
        3. Backward compatibility considerations
        4. Deprecation handling

        Output JSON:
        {
          "versioning_strategy": "URL-based",
          "versions_found": ["v1", "v2"],
          "backward_compatible": true,
          "score": 85
        }
        """

    def get_default_result(self) -> dict[str, Any]:
        """Get default result structure."""
        return {
            "score": 0,
            "versioning_strategy": "unknown",
            "versions_found": []
        }

# Register custom analyzer
AnalyzerFactory.ANALYZER_CLASSES["api_versioning"] = CustomAnalyzer

# Use it
from ai_analyzer import AIAnalyzerRunner

runner = AIAnalyzerRunner(project_dir, project_index)
insights = asyncio.run(
    runner.run_full_analysis(selected_analyzers=["api_versioning"])
)
```

### Batch Analysis

```python
# Analyze multiple projects
projects = [
    Path("/path/to/project1"),
    Path("/path/to/project2"),
    Path("/path/to/project3"),
]

results = {}
for project in projects:
    index_file = project / "comprehensive_analysis.json"
    if not index_file.exists():
        continue

    project_index = json.loads(index_file.read_text())
    runner = AIAnalyzerRunner(project, project_index)

    insights = asyncio.run(runner.run_full_analysis())
    results[project.name] = insights["overall_score"]

# Compare scores
for name, score in sorted(results.items(), key=lambda x: x[1], reverse=True):
    print(f"{name}: {score}/100")
```

### Custom Output Formatting

```python
from ai_analyzer.summary_printer import SummaryPrinter

class CustomPrinter(SummaryPrinter):
    """Custom summary printer with JSON output."""

    @staticmethod
    def print_summary(insights: dict) -> None:
        """Print as formatted JSON."""
        import json
        print(json.dumps(insights, indent=2))

# Use custom printer
runner = AIAnalyzerRunner(project_dir, project_index)
runner.summary_printer = CustomPrinter()

insights = asyncio.run(runner.run_full_analysis())
runner.print_summary(insights)  # Outputs JSON
```

## Integration Examples

### CI/CD Pipeline

```bash
#!/bin/bash
# ci-analyze.sh - Run AI analysis in CI/CD

set -e

# Run programmatic analysis first
python analyzer.py --project-dir . --index

# Run AI analysis
python ai_analyzer_runner.py --project-dir . --analyzers security

# Check security score
SECURITY_SCORE=$(python -c "
import json
data = json.load(open('comprehensive_analysis.json'))
print(data.get('security', {}).get('score', 0))
")

# Fail if score too low
if [ "$SECURITY_SCORE" -lt 70 ]; then
    echo "Security score too low: $SECURITY_SCORE"
    exit 1
fi

echo "Security score acceptable: $SECURITY_SCORE"
```

### Pre-commit Hook

```python
# .git/hooks/pre-commit
#!/usr/bin/env python3
import asyncio
import json
from pathlib import Path
from ai_analyzer import AIAnalyzerRunner

def main():
    project_dir = Path.cwd()
    index_file = project_dir / "comprehensive_analysis.json"

    if not index_file.exists():
        return 0  # Skip if no analysis exists

    project_index = json.loads(index_file.read_text())
    runner = AIAnalyzerRunner(project_dir, project_index)

    # Run security analysis only
    insights = asyncio.run(
        runner.run_full_analysis(selected_analyzers=["security"])
    )

    # Check for critical vulnerabilities
    vulns = insights.get("security", {}).get("vulnerabilities", [])
    critical = [v for v in vulns if v["severity"] == "critical"]

    if critical:
        print(f"❌ Cannot commit: {len(critical)} critical vulnerabilities found")
        for v in critical:
            print(f"  - {v['type']} in {v['location']}")
        return 1

    return 0

if __name__ == "__main__":
    exit(main())
```

### Scheduled Analysis Report

```python
# scheduled_report.py
import asyncio
import json
from datetime import datetime
from pathlib import Path
from ai_analyzer import AIAnalyzerRunner

async def generate_report(project_dir: Path):
    """Generate analysis report."""
    index_file = project_dir / "comprehensive_analysis.json"
    project_index = json.loads(index_file.read_text())

    runner = AIAnalyzerRunner(project_dir, project_index)
    insights = await runner.run_full_analysis(skip_cache=True)

    # Save detailed report
    report_dir = project_dir / "reports"
    report_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_file = report_dir / f"ai_analysis_{timestamp}.json"

    with open(report_file, "w") as f:
        json.dump(insights, f, indent=2)

    print(f"Report saved to: {report_file}")

    # Send notification (example)
    if insights["overall_score"] < 70:
        send_alert(f"Code quality alert: Score {insights['overall_score']}/100")

# Run daily at 2 AM
if __name__ == "__main__":
    asyncio.run(generate_report(Path.cwd()))
```

## Error Handling

```python
from ai_analyzer import AIAnalyzerRunner
from ai_analyzer.claude_client import CLAUDE_SDK_AVAILABLE

# Check SDK availability
if not CLAUDE_SDK_AVAILABLE:
    print("Please install: pip install claude-agent-sdk")
    exit(1)

# Handle missing OAuth token
import os
if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
    print("Please set CLAUDE_CODE_OAUTH_TOKEN")
    print("Run: claude setup-token")
    exit(1)

# Handle analysis errors gracefully
try:
    runner = AIAnalyzerRunner(project_dir, project_index)
    insights = asyncio.run(runner.run_full_analysis())

    # Check for analyzer errors
    for name, result in insights.items():
        if isinstance(result, dict) and "error" in result:
            print(f"Warning: {name} failed: {result['error']}")

except Exception as e:
    print(f"Analysis failed: {e}")
    exit(1)
```
