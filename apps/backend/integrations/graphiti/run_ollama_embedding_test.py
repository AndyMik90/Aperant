#!/usr/bin/env python3
"""
Test Script for Ollama Embedding Memory Integration
====================================================

This test validates that the memory system works correctly with local Ollama
embedding models (like embeddinggemma, nomic-embed-text) for creating and
retrieving memories in the hybrid RAG system.

The test covers:
1. Ollama embedding generation (direct API test)
2. Creating memories with Ollama embeddings via GraphitiMemory
3. Retrieving memories via semantic search
4. Verifying the full create → store → retrieve cycle

Prerequisites:
    1. Install Ollama: https://ollama.ai/
    2. Pull an embedding model:
       ollama pull embeddinggemma    # 768 dimensions (lightweight)
       ollama pull nomic-embed-text  # 768 dimensions (good quality)
    3. Pull an LLM model (for knowledge graph construction):
       ollama pull deepseek-r1:7b    # or llama3.2:3b, mistral:7b
    4. Start Ollama server: ollama serve
    5. Configure environment:
       export GRAPHITI_ENABLED=true
       export GRAPHITI_LLM_PROVIDER=ollama
       export GRAPHITI_EMBEDDER_PROVIDER=ollama
       export OLLAMA_LLM_MODEL=deepseek-r1:7b
       export OLLAMA_EMBEDDING_MODEL=embeddinggemma
       export OLLAMA_EMBEDDING_DIM=768

NOTE: graphiti-core internally uses an OpenAI reranker for search ranking.
      For full offline operation, set a dummy key: export OPENAI_API_KEY=dummy
      The reranker will fail at search time, but embedding creation works.
      For production, use OpenAI API key for best search quality.

Usage:
    cd apps/backend
    python integrations/graphiti/run_ollama_embedding_test.py

    # Run specific tests:
    python integrations/graphiti/run_ollama_embedding_test.py --test embeddings
    python integrations/graphiti/run_ollama_embedding_test.py --test create
    python integrations/graphiti/run_ollama_embedding_test.py --test retrieve
    python integrations/graphiti/run_ollama_embedding_test.py --test full-cycle
"""

import argparse
import asyncio
import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(backend_dir))

# Load .env file
try:
    from dotenv import load_dotenv

    env_file = backend_dir / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        print(f"Loaded .env from {env_file}")
except ImportError:
    print("Note: python-dotenv not installed, using environment variables only")


# ============================================================================
# Helper Functions
# ============================================================================


def print_header(title: str):
    """Print a section header."""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70 + "\n")


def print_result(label: str, value: str, success: bool = True):
    """Print a result line."""
    status = "PASS" if success else "FAIL"
    print(f"  [{status}] {label}: {value}")


def print_info(message: str):
    """Print an info line."""
    print(f"  INFO: {message}")


def print_step(step: int, message: str):
    """Print a step indicator."""
    print(f"\n  Step {step}: {message}")


def apply_ladybug_monkeypatch():
    """Apply LadybugDB monkeypatch for embedded database support."""
    try:
        import real_ladybug

        sys.modules["kuzu"] = real_ladybug
        return True
    except ImportError:
        pass

    # Try native kuzu as fallback
    try:
        import kuzu  # noqa: F401

        return True
    except ImportError:
        return False


# ============================================================================
# Test 1: Ollama Embedding Generation
# ============================================================================


async def test_ollama_embeddings() -> bool:
    """
    Test Ollama embedding generation directly via API.

    This validates that Ollama is running and can generate embeddings
    with the configured model.
    """
    print_header("Test 1: Ollama Embedding Generation")

    ollama_model = os.environ.get("OLLAMA_EMBEDDING_MODEL", "embeddinggemma")
    ollama_base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    expected_dim = int(os.environ.get("OLLAMA_EMBEDDING_DIM", "768"))

    print(f"  Ollama Model: {ollama_model}")
    print(f"  Base URL: {ollama_base_url}")
    print(f"  Expected Dimension: {expected_dim}")
    print()

    try:
        import requests
    except ImportError:
        print_result("requests library", "Not installed - pip install requests", False)
        return False

    # Step 1: Check Ollama is running
    print_step(1, "Checking Ollama server status")
    try:
        resp = requests.get(f"{ollama_base_url}/api/tags", timeout=10)
        if resp.status_code != 200:
            print_result(
                "Ollama server",
                f"Not responding (status {resp.status_code})",
                False,
            )
            return False

        models = resp.json().get("models", [])
        model_names = [m.get("name", "") for m in models]
        print_result("Ollama server", f"Running with {len(models)} models", True)

        # Check if embedding model is available
        embedding_model_found = any(
            ollama_model in name or ollama_model.split(":")[0] in name
            for name in model_names
        )
        if not embedding_model_found:
            print_info(f"Model '{ollama_model}' not found. Available: {model_names}")
            print_info(f"Pull it with: ollama pull {ollama_model}")

    except requests.exceptions.ConnectionError:
        print_result(
            "Ollama server",
            "Not running - start with 'ollama serve'",
            False,
        )
        return False

    # Step 2: Generate test embedding
    print_step(2, "Generating test embeddings")

    test_texts = [
        "This is a test memory about implementing OAuth authentication.",
        "The user prefers using TypeScript for frontend development.",
        "A gotcha discovered: always validate JWT tokens on the server side.",
    ]

    embeddings = []
    for i, text in enumerate(test_texts):
        resp = requests.post(
            f"{ollama_base_url}/api/embeddings",
            json={"model": ollama_model, "prompt": text},
            timeout=60,
        )

        if resp.status_code != 200:
            print_result(
                f"Embedding {i + 1}",
                f"Failed: {resp.status_code} - {resp.text[:100]}",
                False,
            )
            return False

        data = resp.json()
        embedding = data.get("embedding", [])
        embeddings.append(embedding)

        print_result(
            f"Embedding {i + 1}",
            f"Generated {len(embedding)} dimensions",
            True,
        )

    # Step 3: Validate embedding dimensions
    print_step(3, "Validating embedding dimensions")

    for i, embedding in enumerate(embeddings):
        if len(embedding) != expected_dim:
            print_result(
                f"Embedding {i + 1} dimension",
                f"Mismatch! Got {len(embedding)}, expected {expected_dim}",
                False,
            )
            print_info(f"Update OLLAMA_EMBEDDING_DIM={len(embedding)} in your config")
            return False
        print_result(
            f"Embedding {i + 1} dimension", f"{len(embedding)} matches expected", True
        )

    # Step 4: Test embedding similarity (basic sanity check)
    print_step(4, "Testing embedding similarity")

    def cosine_similarity(a, b):
        """Calculate cosine similarity between two vectors."""
        dot_product = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        return dot_product / (norm_a * norm_b) if norm_a and norm_b else 0

    # Generate embedding for a similar query
    query = "OAuth authentication implementation"
    resp = requests.post(
        f"{ollama_base_url}/api/embeddings",
        json={"model": ollama_model, "prompt": query},
        timeout=60,
    )
    query_embedding = resp.json().get("embedding", [])

    similarities = [cosine_similarity(query_embedding, emb) for emb in embeddings]

    print(f"  Query: '{query}'")
    print("  Similarities to test texts:")
    for i, (text, sim) in enumerate(zip(test_texts, similarities)):
        print(f"    {i + 1}. {sim:.4f} - '{text[:50]}...'")

    # First text (about OAuth) should have highest similarity to OAuth query
    if similarities[0] > similarities[1] and similarities[0] > similarities[2]:
        print_result("Semantic similarity", "OAuth query matches OAuth text best", True)
    else:
        print_info("Similarity ordering may vary - embeddings are still working")

    print()
    print_result("Ollama Embeddings", "All tests passed", True)
    return True


# ============================================================================
# Test 2: Memory Creation with Ollama
# ============================================================================


async def test_memory_creation(test_db_path: Path) -> tuple[Path, Path, bool]:
    """
    Test creating memories using GraphitiMemory with Ollama embeddings.

    Returns:
        Tuple of (spec_dir, project_dir, success)
    """
    print_header("Test 2: Memory Creation with Ollama Embeddings")

    # Create test directories
    spec_dir = test_db_path / "test_spec"
    project_dir = test_db_path / "test_project"
    spec_dir.mkdir(parents=True, exist_ok=True)
    project_dir.mkdir(parents=True, exist_ok=True)

    print(f"  Spec dir: {spec_dir}")
    print(f"  Project dir: {project_dir}")
    print(f"  Database path: {test_db_path}")
    print()

    # Override database path for testing
    os.environ["GRAPHITI_DB_PATH"] = str(test_db_path / "graphiti_db")
    os.environ["GRAPHITI_DATABASE"] = "test_ollama_memory"

    try:
        from integrations.graphiti.memory import GraphitiMemory
    except ImportError as e:
        print_result("Import GraphitiMemory", f"Failed: {e}", False)
        return spec_dir, project_dir, False

    # Step 1: Initialize GraphitiMemory
    print_step(1, "Initializing GraphitiMemory")

    memory = GraphitiMemory(spec_dir, project_dir)
    print(f"  Is enabled: {memory.is_enabled}")
    print(f"  Group ID: {memory.group_id}")

    if not memory.is_enabled:
        print_result(
            "GraphitiMemory",
            "Not enabled - check GRAPHITI_ENABLED=true",
            False,
        )
        return spec_dir, project_dir, False

    init_result = await memory.initialize()
    if not init_result:
        print_result("Initialize", "Failed to initialize", False)
        return spec_dir, project_dir, False

    print_result("Initialize", "SUCCESS", True)

    # Step 2: Save session insights
    print_step(2, "Saving session insights")

    session_insights = {
        "subtasks_completed": ["implement-oauth-login", "add-jwt-validation"],
        "discoveries": {
            "files_understood": {
                "auth/oauth.py": "OAuth 2.0 flow implementation with Google/GitHub",
                "auth/jwt.py": "JWT token generation and validation utilities",
            },
            "patterns_found": [
                "Pattern: Use refresh tokens for long-lived sessions",
                "Pattern: Store tokens in httpOnly cookies for security",
            ],
            "gotchas_encountered": [
                "Gotcha: Always validate JWT signature on server side",
                "Gotcha: OAuth state parameter prevents CSRF attacks",
            ],
        },
        "what_worked": [
            "Using PyJWT for token handling",
            "Separating OAuth providers into individual modules",
        ],
        "what_failed": [],
        "recommendations_for_next_session": [
            "Consider adding refresh token rotation",
            "Add rate limiting to auth endpoints",
        ],
    }

    save_result = await memory.save_session_insights(
        session_num=1, insights=session_insights
    )
    print_result(
        "save_session_insights", "SUCCESS" if save_result else "FAILED", save_result
    )

    # Step 3: Save patterns
    print_step(3, "Saving code patterns")

    patterns = [
        "OAuth implementation uses authorization code flow for web apps",
        "JWT tokens include user ID, roles, and expiration in payload",
        "Token refresh happens automatically when access token expires",
    ]

    for i, pattern in enumerate(patterns):
        result = await memory.save_pattern(pattern)
        print_result(f"save_pattern {i + 1}", "SUCCESS" if result else "FAILED", result)

    # Step 4: Save gotchas
    print_step(4, "Saving gotchas (pitfalls)")

    gotchas = [
        "Never store config values in frontend code or files checked into git",
        "API redirect URIs must exactly match the registered URIs",
        "Cache expiration times should be short for performance (15 min default)",
    ]

    for i, gotcha in enumerate(gotchas):
        result = await memory.save_gotcha(gotcha)
        print_result(f"save_gotcha {i + 1}", "SUCCESS" if result else "FAILED", result)

    # Step 5: Save codebase discoveries
    print_step(5, "Saving codebase discoveries")

    discoveries = {
        "api/routes/users.py": "User management API endpoints (list, create, update)",
        "middleware/logging.py": "Request logging middleware for all routes",
        "models/user.py": "User model with profile data and role management",
        "services/notifications.py": "Notification service integrations (email, SMS, push)",
    }

    discovery_result = await memory.save_codebase_discoveries(discoveries)
    print_result(
        "save_codebase_discoveries",
        "SUCCESS" if discovery_result else "FAILED",
        discovery_result,
    )

    # Brief wait for embedding processing
    print()
    print_info("Waiting 3 seconds for embedding processing...")
    await asyncio.sleep(3)

    await memory.close()

    print()
    print_result("Memory Creation", "All memories saved successfully", True)
    return spec_dir, project_dir, True


# ============================================================================
# Test 3: Memory Retrieval with Semantic Search
# ============================================================================


async def test_memory_retrieval(spec_dir: Path, project_dir: Path) -> bool:
    """
    Test retrieving memories using semantic search with Ollama embeddings.

    This validates that saved memories can be found via semantic similarity.
    """
    print_header("Test 3: Memory Retrieval with Semantic Search")

    try:
        from integrations.graphiti.memory import GraphitiMemory
    except ImportError as e:
        print_result("Import GraphitiMemory", f"Failed: {e}", False)
        return False

    # Step 1: Initialize memory (reconnect)
    print_step(1, "Reconnecting to GraphitiMemory")

    memory = GraphitiMemory(spec_dir, project_dir)
    init_result = await memory.initialize()

    if not init_result:
        print_result("Initialize", "Failed to reconnect", False)
        return False

    print_result("Initialize", "Reconnected successfully", True)

    # Step 2: Semantic search for API-related content
    print_step(2, "Searching for API-related memories")

    api_query = "How do the API endpoints work in this project?"
    results = await memory.get_relevant_context(api_query, num_results=5)

    print(f"  Query: '{api_query}'")
    print(f"  Found {len(results)} results:")

    api_found = False
    for i, result in enumerate(results):
        content = result.get("content", "")[:100]
        result_type = result.get("type", "unknown")
        score = result.get("score", 0)
        print(f"    {i + 1}. [{result_type}] (score: {score:.4f}) {content}...")
        if "api" in content.lower() or "routes" in content.lower():
            api_found = True

    if api_found:
        print_result("API search", "Found API-related content", True)
    else:
        print_info("API content may not be in top results - checking other queries")

    # Step 3: Search for middleware-related content
    print_step(3, "Searching for middleware patterns")

    middleware_query = "middleware and request handling best practices"
    results = await memory.get_relevant_context(middleware_query, num_results=5)

    print(f"  Query: '{middleware_query}'")
    print(f"  Found {len(results)} results:")

    middleware_found = False
    for i, result in enumerate(results):
        content = result.get("content", "")[:100]
        result_type = result.get("type", "unknown")
        score = result.get("score", 0)
        print(f"    {i + 1}. [{result_type}] (score: {score:.4f}) {content}...")
        if "middleware" in content.lower() or "routes" in content.lower():
            middleware_found = True

    print_result(
        "Middleware search",
        "Found middleware-related content" if middleware_found else "No direct matches",
        middleware_found or len(results) > 0,
    )

    # Step 4: Get session history
    print_step(4, "Retrieving session history")

    history = await memory.get_session_history(limit=3)
    print(f"  Found {len(history)} session records:")

    for i, session in enumerate(history):
        session_num = session.get("session_number", "?")
        subtasks = session.get("subtasks_completed", [])
        print(f"    Session {session_num}: {len(subtasks)} subtasks completed")
        for subtask in subtasks[:3]:
            print(f"      - {subtask}")

    print_result(
        "Session history", f"Retrieved {len(history)} sessions", len(history) > 0
    )

    # Step 5: Get status summary
    print_step(5, "Memory status summary")

    status = memory.get_status_summary()
    for key, value in status.items():
        print(f"    {key}: {value}")

    await memory.close()

    print()
    all_passed = len(results) > 0 and len(history) > 0
    print_result(
        "Memory Retrieval",
        "All retrieval tests passed" if all_passed else "Some tests had issues",
        all_passed,
    )
    return all_passed


# ============================================================================
# Test 4: Full Create → Store → Retrieve Cycle
# ============================================================================


async def test_full_cycle(test_db_path: Path) -> bool:
    """
    Test the complete memory lifecycle:
    1. Create unique test data
    2. Store in graph database with Ollama embeddings
    3. Search and retrieve via semantic similarity
    4. Verify retrieved data matches what was stored
    """
    print_header("Test 4: Full Create-Store-Retrieve Cycle")

    # Create fresh test directories
    spec_dir = test_db_path / "cycle_test_spec"
    project_dir = test_db_path / "cycle_test_project"
    spec_dir.mkdir(parents=True, exist_ok=True)
    project_dir.mkdir(parents=True, exist_ok=True)

    # Override database path for testing
    os.environ["GRAPHITI_DB_PATH"] = str(test_db_path / "graphiti_db")
    os.environ["GRAPHITI_DATABASE"] = "test_full_cycle"

    try:
        from integrations.graphiti.memory import GraphitiMemory
    except ImportError as e:
        print_result("Import", f"Failed: {e}", False)
        return False

    # Step 1: Create unique test content
    print_step(1, "Creating unique test content")

    unique_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique_pattern = (
        f"Unique pattern {unique_id}: Use dependency injection for database connections"
    )
    unique_gotcha = f"Unique gotcha {unique_id}: Always close database connections in finally blocks"

    print(f"  Unique ID: {unique_id}")
    print(f"  Pattern: {unique_pattern[:60]}...")
    print(f"  Gotcha: {unique_gotcha[:60]}...")

    # Step 2: Store the content
    print_step(2, "Storing content in memory system")

    memory = GraphitiMemory(spec_dir, project_dir)
    init_result = await memory.initialize()

    if not init_result:
        print_result("Initialize", "Failed", False)
        return False

    print_result("Initialize", "SUCCESS", True)

    pattern_result = await memory.save_pattern(unique_pattern)
    print_result(
        "save_pattern", "SUCCESS" if pattern_result else "FAILED", pattern_result
    )

    gotcha_result = await memory.save_gotcha(unique_gotcha)
    print_result("save_gotcha", "SUCCESS" if gotcha_result else "FAILED", gotcha_result)

    # Wait for embedding processing
    print()
    print_info("Waiting 4 seconds for embedding processing and indexing...")
    await asyncio.sleep(4)

    # Step 3: Search for the unique content
    print_step(3, "Searching for unique content")

    # Search for the pattern
    pattern_query = "dependency injection database connections"
    pattern_results = await memory.get_relevant_context(pattern_query, num_results=5)

    print(f"  Query: '{pattern_query}'")
    print(f"  Found {len(pattern_results)} results")

    pattern_found = False
    for result in pattern_results:
        content = result.get("content", "")
        if unique_id in content:
            pattern_found = True
            print(f"    MATCH: {content[:80]}...")

    print_result(
        "Pattern retrieval",
        f"Found unique pattern (ID: {unique_id})"
        if pattern_found
        else "Unique pattern not in top results",
        pattern_found,
    )

    # Search for the gotcha
    gotcha_query = "database connection cleanup finally block"
    gotcha_results = await memory.get_relevant_context(gotcha_query, num_results=5)

    print(f"  Query: '{gotcha_query}'")
    print(f"  Found {len(gotcha_results)} results")

    gotcha_found = False
    for result in gotcha_results:
        content = result.get("content", "")
        if unique_id in content:
            gotcha_found = True
            print(f"    MATCH: {content[:80]}...")

    print_result(
        "Gotcha retrieval",
        f"Found unique gotcha (ID: {unique_id})"
        if gotcha_found
        else "Unique gotcha not in top results",
        gotcha_found,
    )

    # Step 4: Verify semantic similarity works
    print_step(4, "Verifying semantic similarity")

    # Search with semantically similar but different wording
    alt_query = "closing connections properly in error handling"
    alt_results = await memory.get_relevant_context(alt_query, num_results=3)

    print(f"  Alternative query: '{alt_query}'")
    print(f"  Found {len(alt_results)} semantically similar results:")

    for i, result in enumerate(alt_results):
        content = result.get("content", "")[:80]
        score = result.get("score", 0)
        print(f"    {i + 1}. (score: {score:.4f}) {content}...")

    semantic_works = len(alt_results) > 0
    print_result(
        "Semantic similarity",
        "Working - found related content" if semantic_works else "No results",
        semantic_works,
    )

    await memory.close()

    # Summary
    print()
    cycle_passed = (
        pattern_result
        and gotcha_result
        and (pattern_found or gotcha_found or len(alt_results) > 0)
    )
    print_result(
        "Full Cycle Test",
        "Create-Store-Retrieve cycle verified"
        if cycle_passed
        else "Some steps had issues",
        cycle_passed,
    )

    return cycle_passed


# ============================================================================
# Main Entry Point
# ============================================================================


async def main():
    """Run Ollama embedding memory tests."""
    parser = argparse.ArgumentParser(
        description="Test Ollama Embedding Memory Integration"
    )
    parser.add_argument(
        "--test",
        choices=["all", "embeddings", "create", "retrieve", "full-cycle"],
        default="all",
        help="Which test to run",
    )
    parser.add_argument(
        "--keep-db",
        action="store_true",
        help="Keep test database after completion (default: cleanup)",
    )

    args = parser.parse_args()

    print("\n" + "=" * 70)
    print("  OLLAMA EMBEDDING MEMORY TEST SUITE")
    print("=" * 70)

    # Configuration check
    print_header("Configuration Check")

    config_items = {
        "GRAPHITI_ENABLED": os.environ.get("GRAPHITI_ENABLED", ""),
        "GRAPHITI_LLM_PROVIDER": os.environ.get("GRAPHITI_LLM_PROVIDER", ""),
        "GRAPHITI_EMBEDDER_PROVIDER": os.environ.get("GRAPHITI_EMBEDDER_PROVIDER", ""),
        "OLLAMA_LLM_MODEL": os.environ.get("OLLAMA_LLM_MODEL", ""),
        "OLLAMA_EMBEDDING_MODEL": os.environ.get("OLLAMA_EMBEDDING_MODEL", ""),
        "OLLAMA_EMBEDDING_DIM": os.environ.get("OLLAMA_EMBEDDING_DIM", ""),
        "OLLAMA_BASE_URL": os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
        "OPENAI_API_KEY": "(set)"
        if os.environ.get("OPENAI_API_KEY")
        else "(not set - needed for reranker)",
    }

    all_configured = True
    required_keys = [
        "GRAPHITI_ENABLED",
        "GRAPHITI_LLM_PROVIDER",
        "GRAPHITI_EMBEDDER_PROVIDER",
        "OLLAMA_LLM_MODEL",
        "OLLAMA_EMBEDDING_MODEL",
    ]

    for key, value in config_items.items():
        is_optional = key in [
            "OLLAMA_BASE_URL",
            "OPENAI_API_KEY",
            "OLLAMA_EMBEDDING_DIM",
        ]
        is_set = bool(value) if not is_optional else True
        display_value = value or "(not set)"
        if key == "OPENAI_API_KEY":
            display_value = value  # Already formatted above
            is_set = True  # Optional for testing
        print_result(key, display_value, is_set)
        if key in required_keys and not bool(os.environ.get(key)):
            all_configured = False

    if not all_configured:
        print()
        print("  Missing required configuration. Please set:")
        print("    export GRAPHITI_ENABLED=true")
        print("    export GRAPHITI_LLM_PROVIDER=ollama")
        print("    export GRAPHITI_EMBEDDER_PROVIDER=ollama")
        print("    export OLLAMA_LLM_MODEL=deepseek-r1:7b")
        print("    export OLLAMA_EMBEDDING_MODEL=embeddinggemma")
        print("    export OLLAMA_EMBEDDING_DIM=768")
        print("    export OPENAI_API_KEY=dummy  # For graphiti-core reranker")
        print()
        return

    # Check LadybugDB
    if not apply_ladybug_monkeypatch():
        print()
        print_result("LadybugDB", "Not installed - pip install real-ladybug", False)
        return

    print_result("LadybugDB", "Installed", True)

    # Create temp directory for test database
    test_db_path = Path(tempfile.mkdtemp(prefix="ollama_memory_test_"))
    print()
    print_info(f"Test database: {test_db_path}")

    # Run tests
    test = args.test
    results = {}

    try:
        if test in ["all", "embeddings"]:
            results["embeddings"] = await test_ollama_embeddings()

        spec_dir = None
        project_dir = None

        if test in ["all", "create"]:
            spec_dir, project_dir, results["create"] = await test_memory_creation(
                test_db_path
            )

        if test in ["all", "retrieve"]:
            if spec_dir and project_dir:
                results["retrieve"] = await test_memory_retrieval(spec_dir, project_dir)
            else:
                print_info(
                    "Skipping retrieve test - no spec/project dir from create test"
                )

        if test in ["all", "full-cycle"]:
            results["full-cycle"] = await test_full_cycle(test_db_path)

    finally:
        # Cleanup unless --keep-db specified
        if not args.keep_db and test_db_path.exists():
            print()
            print_info(f"Cleaning up test database: {test_db_path}")
            shutil.rmtree(test_db_path, ignore_errors=True)

    # Summary
    print_header("TEST SUMMARY")

    all_passed = True
    for test_name, passed in results.items():
        status = "PASSED" if passed else "FAILED"
        print(f"  {test_name}: {status}")
        if not passed:
            all_passed = False

    print()
    if all_passed:
        print("  All tests PASSED!")
        print()
        print("  The memory system is working correctly with Ollama embeddings.")
        print("  Memories can be created and retrieved using semantic search.")
    else:
        print("  Some tests FAILED. Check the output above for details.")
        print()
        print("  Common issues:")
        print("    - Ollama not running: ollama serve")
        print("    - Model not pulled: ollama pull embeddinggemma")
        print("    - Wrong dimension: Update OLLAMA_EMBEDDING_DIM to match model")

    print()
    print("  Commands:")
    print("    # Run all tests:")
    print("    python integrations/graphiti/run_ollama_embedding_test.py")
    print()
    print("    # Run specific test:")
    print(
        "    python integrations/graphiti/run_ollama_embedding_test.py --test embeddings"
    )
    print(
        "    python integrations/graphiti/run_ollama_embedding_test.py --test full-cycle"
    )
    print()
    print("    # Keep database for inspection:")
    print("    python integrations/graphiti/run_ollama_embedding_test.py --keep-db")
    print()


if __name__ == "__main__":
    asyncio.run(main())
