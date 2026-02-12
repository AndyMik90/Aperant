#!/usr/bin/env python3
"""
Test Script for Memory Integration with LadybugDB
=================================================

This script tests the memory layer (graph + semantic search) to verify
data is being saved and retrieved correctly from LadybugDB (embedded Kuzu).

LadybugDB is an embedded graph database - no Docker required!

Usage:
    # Set environment variables first (or in .env file):
    export GRAPHITI_ENABLED=true
    export GRAPHITI_EMBEDDER_PROVIDER=ollama  # or: openai, voyage, azure_openai, google

    # For Ollama (recommended - free, local):
    export OLLAMA_EMBEDDING_MODEL=embeddinggemma
    export OLLAMA_EMBEDDING_DIM=768

    # For OpenAI:
    export OPENAI_API_KEY=sk-...

    # Run the test:
    cd auto-claude
    python integrations/graphiti/run_graphiti_memory_test.py

    # Or run specific tests:
    python integrations/graphiti/run_graphiti_memory_test.py --test connection
    python integrations/graphiti/run_graphiti_memory_test.py --test save
    python integrations/graphiti/run_graphiti_memory_test.py --test search
    python integrations/graphiti/run_graphiti_memory_test.py --test ollama
"""

import argparse
import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# Load .env file
try:
    from dotenv import load_dotenv

    env_file = Path(__file__).parent.parent.parent.parent / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        print(f"Loaded .env from {env_file}")
except ImportError:
    print("Note: python-dotenv not installed, using environment variables only")


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


def print_header(title: str):
    """Print a section header."""
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60 + "\n")


def print_result(label: str, value: str, success: bool = True):
    """Print a result line."""
    status = "✅" if success else "❌"
    print(f"  {status} {label}: {value}")


def print_info(message: str):
    """Print an info line."""
    print(f"  ℹ️  {message}")


async def test_ladybugdb_connection(db_path: str, database: str) -> bool:
    """Test basic LadybugDB connection."""
    print_header("1. Testing LadybugDB Connection")

    print(f"  Database path: {db_path}")
    print(f"  Database name: {database}")
    print()

    if not apply_ladybug_monkeypatch():
        print_result("LadybugDB", "Not installed (pip install real-ladybug)", False)
        return False

    print_result("LadybugDB", "Installed", True)

    try:
        import kuzu  # This is real_ladybug via monkeypatch

        # Ensure parent directory exists (database will create its own structure)
        full_path = Path(db_path) / database
        full_path.parent.mkdir(parents=True, exist_ok=True)

        # Create database and connection
        db = kuzu.Database(str(full_path))
        conn = kuzu.Connection(db)

        # Test basic query
        result = conn.execute("RETURN 1 + 1 as test")
        df = result.get_as_df()
        test_value = df["test"].iloc[0] if len(df) > 0 else None

        if test_value == 2:
            print_result("Connection", "SUCCESS - Database responds correctly", True)
            return True
        else:
            print_result("Connection", f"Unexpected result: {test_value}", False)
            return False

    except Exception as e:
        print_result("Connection", f"FAILED: {e}", False)
        return False


async def test_save_episode(db_path: str, database: str) -> tuple[str, str]:
    """Test saving an episode to the graph."""
    print_header("2. Testing Episode Save")

    try:
        from integrations.graphiti.config import GraphitiConfig
        from integrations.graphiti.queries_pkg.client import GraphitiClient

        # Create config
        config = GraphitiConfig.from_env()
        config.db_path = db_path
        config.database = database
        config.enabled = True

        print(f"  Embedder provider: {config.embedder_provider}")
        print()

        # Initialize client
        client = GraphitiClient(config)
        initialized = await client.initialize()

        if not initialized:
            print_result("Client Init", "Failed to initialize", False)
            return None, None

        print_result("Client Init", "SUCCESS", True)

        # Create test episode data
        test_data = {
            "type": "test_episode",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "test_field": "Hello from LadybugDB test!",
            "test_number": 42,
            "embedder": config.embedder_provider,
        }

        episode_name = (
            f"test_episode_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
        )
        group_id = "ladybug_test_group"

        print(f"  Episode name: {episode_name}")
        print(f"  Group ID: {group_id}")
        print(f"  Data: {json.dumps(test_data, indent=4)}")
        print()

        # Save using Graphiti
        from graphiti_core.nodes import EpisodeType

        print("  Saving episode...")
        await client.graphiti.add_episode(
            name=episode_name,
            episode_body=json.dumps(test_data),
            source=EpisodeType.text,
            source_description="Test episode from run_graphiti_memory_test.py",
            reference_time=datetime.now(timezone.utc),
            group_id=group_id,
        )

        print_result("Episode Save", "SUCCESS", True)

        await client.close()
        return episode_name, group_id

    except ImportError as e:
        print_result("Import", f"Missing dependency: {e}", False)
        return None, None
    except Exception as e:
        print_result("Episode Save", f"FAILED: {e}", False)
        import traceback

        traceback.print_exc()
        return None, None


async def test_keyword_search(db_path: str, database: str) -> bool:
    """Test keyword search (works without embeddings)."""
    print_header("3. Testing Keyword Search")

    if not apply_ladybug_monkeypatch():
        print_result("LadybugDB", "Not installed", False)
        return False

    try:
        import kuzu

        full_path = Path(db_path) / database
        if not full_path.exists():
            print_info("Database doesn't exist yet - run save test first")
            return True

        db = kuzu.Database(str(full_path))
        conn = kuzu.Connection(db)

        # Search for test episodes
        search_query = "test"
        print(f"  Search query: '{search_query}'")
        print()

        query = f"""
            MATCH (e:Episodic)
            WHERE toLower(e.name) CONTAINS '{search_query}'
               OR toLower(e.content) CONTAINS '{search_query}'
            RETURN e.name as name, e.content as content
            LIMIT 5
        """

        try:
            result = conn.execute(query)
            df = result.get_as_df()

            print(f"  Found {len(df)} results:")
            for _, row in df.iterrows():
                name = row.get("name", "unknown")[:50]
                content = str(row.get("content", ""))[:60]
                print(f"    - {name}: {content}...")

            print_result("Keyword Search", f"Found {len(df)} results", True)
            return True

        except Exception as e:
            if "Episodic" in str(e) and "not exist" in str(e).lower():
                print_info("Episodic table doesn't exist yet - run save test first")
                return True
            raise

    except Exception as e:
        print_result("Keyword Search", f"FAILED: {e}", False)
        return False


async def test_semantic_search(db_path: str, database: str, group_id: str) -> bool:
    """Test semantic search using embeddings."""
    print_header("4. Testing Semantic Search")

    if not group_id:
        print_info("Skipping - no group_id from save test")
        return True

    try:
        from integrations.graphiti.config import GraphitiConfig
        from integrations.graphiti.queries_pkg.client import GraphitiClient

        # Create config
        config = GraphitiConfig.from_env()
        config.db_path = db_path
        config.database = database
        config.enabled = True

        if not config.embedder_provider:
            print_info("No embedder configured - semantic search requires embeddings")
            return True

        print(f"  Embedder: {config.embedder_provider}")
        print()

        # Initialize client
        client = GraphitiClient(config)
        initialized = await client.initialize()

        if not initialized:
            print_result("Client Init", "Failed", False)
            return False

        # Search
        query = "test episode hello LadybugDB"
        print(f"  Query: '{query}'")
        print(f"  Group ID: {group_id}")
        print()

        print("  Searching...")
        results = await client.graphiti.search(
            query=query,
            group_ids=[group_id],
            num_results=10,
        )

        print(f"  Found {len(results)} results:")
        for i, result in enumerate(results[:5]):
            # Print available attributes
            if hasattr(result, "fact") and result.fact:
                print(f"    {i + 1}. [fact] {str(result.fact)[:80]}...")
            elif hasattr(result, "content") and result.content:
                print(f"    {i + 1}. [content] {str(result.content)[:80]}...")
            elif hasattr(result, "name"):
                print(f"    {i + 1}. [name] {str(result.name)[:80]}...")

        await client.close()

        if results:
            print_result(
                "Semantic Search", f"SUCCESS - Found {len(results)} results", True
            )
        else:
            print_result(
                "Semantic Search", "No results (may need time for embedding)", False
            )

        return len(results) > 0

    except Exception as e:
        print_result("Semantic Search", f"FAILED: {e}", False)
        import traceback

        traceback.print_exc()
        return False


async def test_ollama_embeddings() -> bool:
    """Test Ollama embedding generation directly."""
    print_header("5. Testing Ollama Embeddings")

    ollama_model = os.environ.get("OLLAMA_EMBEDDING_MODEL", "embeddinggemma")
    ollama_base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

    print(f"  Model: {ollama_model}")
    print(f"  Base URL: {ollama_base_url}")
    print()

    try:
        import requests

        # Check Ollama status
        print("  Checking Ollama status...")
        try:
            resp = requests.get(f"{ollama_base_url}/api/tags", timeout=5)
            if resp.status_code != 200:
                print_result(
                    "Ollama", f"Not responding (status {resp.status_code})", False
                )
                return False

            models = [m["name"] for m in resp.json().get("models", [])]
            embedding_models = [
                m for m in models if "embed" in m.lower() or "gemma" in m.lower()
            ]
            print_result("Ollama", f"Running with {len(models)} models", True)
            print(f"    Embedding models: {embedding_models}")

        except requests.exceptions.ConnectionError:
            print_result("Ollama", "Not running - start with 'ollama serve'", False)
            return False

        # Test embedding generation
        print()
        print("  Generating test embedding...")

        test_text = (
            "This is a test embedding for Auto Claude memory system using LadybugDB."
        )

        resp = requests.post(
            f"{ollama_base_url}/api/embeddings",
            json={"model": ollama_model, "prompt": test_text},
            timeout=30,
        )

        if resp.status_code == 200:
            data = resp.json()
            embedding = data.get("embedding", [])
            print_result("Embedding", f"SUCCESS - {len(embedding)} dimensions", True)
            print(f"    First 5 values: {embedding[:5]}")

            # Verify dimension matches config
            expected_dim = int(os.environ.get("OLLAMA_EMBEDDING_DIM", 768))
            if len(embedding) == expected_dim:
                print_result("Dimension", f"Matches expected ({expected_dim})", True)
            else:
                print_result(
                    "Dimension",
                    f"Mismatch! Got {len(embedding)}, expected {expected_dim}",
                    False,
                )
                print_info(
                    f"Update OLLAMA_EMBEDDING_DIM={len(embedding)} in your config"
                )

            return True
        else:
            print_result(
                "Embedding", f"FAILED: {resp.status_code} - {resp.text}", False
            )
            return False

    except ImportError:
        print_result("requests", "Not installed (pip install requests)", False)
        return False
    except Exception as e:
        print_result("Ollama Embeddings", f"FAILED: {e}", False)
        return False


async def test_graphiti_memory_class(db_path: str, database: str) -> bool:
    """Test the GraphitiMemory wrapper class."""
    print_header("6. Testing GraphitiMemory Class")

    try:
        from integrations.graphiti.memory import GraphitiMemory

        # Create temporary directories for testing
        test_spec_dir = Path(tempfile.mkdtemp(prefix="graphiti_test_spec_"))
        test_project_dir = Path(tempfile.mkdtemp(prefix="graphiti_test_project_"))

        print(f"  Spec dir: {test_spec_dir}")
        print(f"  Project dir: {test_project_dir}")
        print()

        # Override database path via environment
        os.environ["GRAPHITI_DB_PATH"] = db_path
        os.environ["GRAPHITI_DATABASE"] = database

        # Create memory instance
        memory = GraphitiMemory(test_spec_dir, test_project_dir)

        print(f"  Is enabled: {memory.is_enabled}")
        print(f"  Group ID: {memory.group_id}")
        print()

        if not memory.is_enabled:
            print_info("GraphitiMemory not enabled - check GRAPHITI_ENABLED=true")
            return True

        # Initialize
        print("  Initializing...")
        init_result = await memory.initialize()

        if not init_result:
            print_result("Initialize", "Failed", False)
            return False

        print_result("Initialize", "SUCCESS", True)

        # Test save_session_insights
        print()
        print("  Testing save_session_insights...")
        insights = {
            "subtasks_completed": ["test-subtask-1"],
            "discoveries": {
                "files_understood": {"test.py": "Test file"},
                "patterns_found": ["Pattern: LadybugDB works!"],
                "gotchas_encountered": [],
            },
            "what_worked": ["Using embedded database"],
            "what_failed": [],
            "recommendations_for_next_session": ["Continue testing"],
        }

        save_result = await memory.save_session_insights(
            session_num=1, insights=insights
        )
        print_result(
            "save_session_insights", "SUCCESS" if save_result else "FAILED", save_result
        )

        # Test save_pattern
        print()
        print("  Testing save_pattern...")
        pattern_result = await memory.save_pattern(
            "LadybugDB pattern: Embedded graph database works without Docker"
        )
        print_result(
            "save_pattern", "SUCCESS" if pattern_result else "FAILED", pattern_result
        )

        # Test get_relevant_context
        print()
        print("  Testing get_relevant_context...")
        await asyncio.sleep(1)  # Brief wait for processing

        context = await memory.get_relevant_context("LadybugDB embedded database")
        print(f"  Found {len(context)} context items")

        for item in context[:3]:
            item_type = item.get("type", "unknown")
            content = str(item.get("content", ""))[:60]
            print(f"    - [{item_type}] {content}...")

        print_result("get_relevant_context", f"Found {len(context)} items", True)

        # Get status
        print()
        print("  Status summary:")
        status = memory.get_status_summary()
        for key, value in status.items():
            print(f"    {key}: {value}")

        await memory.close()
        print_result("GraphitiMemory", "All tests passed", True)
        return True

    except ImportError as e:
        print_result("Import", f"Missing: {e}", False)
        return False
    except Exception as e:
        print_result("GraphitiMemory", f"FAILED: {e}", False)
        import traceback

        traceback.print_exc()
        return False


async def test_database_contents(db_path: str, database: str) -> bool:
    """Show what's in the database (debug)."""
    print_header("7. Database Contents (Debug)")

    if not apply_ladybug_monkeypatch():
        print_result("LadybugDB", "Not installed", False)
        return False

    try:
        import kuzu

        full_path = Path(db_path) / database
        if not full_path.exists():
            print_info(f"Database doesn't exist at {full_path}")
            return True

        db = kuzu.Database(str(full_path))
        conn = kuzu.Connection(db)

        # Get table info
        print("  Checking tables...")

        tables_to_check = ["Episodic", "Entity", "Community"]

        for table in tables_to_check:
            try:
                result = conn.execute(f"MATCH (n:{table}) RETURN count(n) as count")
                df = result.get_as_df()
                count = df["count"].iloc[0] if len(df) > 0 else 0
                print(f"    {table}: {count} nodes")
            except Exception as e:
                if "not exist" in str(e).lower() or "cannot" in str(e).lower():
                    print(f"    {table}: (table not created yet)")
                else:
                    print(f"    {table}: Error - {e}")

        # Show sample episodic nodes
        print()
        print("  Sample Episodic nodes:")
        try:
            result = conn.execute("""
                MATCH (e:Episodic)
                RETURN e.name as name, e.created_at as created
                ORDER BY e.created_at DESC
                LIMIT 5
            """)
            df = result.get_as_df()

            if len(df) == 0:
                print("    (none)")
            else:
                for _, row in df.iterrows():
                    print(f"    - {row.get('name', 'unknown')}")
        except Exception as e:
            if "Episodic" in str(e):
                print("    (table not created yet)")
            else:
                print(f"    Error: {e}")

        print_result("Database Contents", "Displayed", True)
        return True

    except Exception as e:
        print_result("Database Contents", f"FAILED: {e}", False)
        return False


async def main():
    """Run all tests."""
    parser = argparse.ArgumentParser(description="Test Memory System with LadybugDB")
    parser.add_argument(
        "--test",
        choices=[
            "all",
            "connection",
            "save",
            "keyword",
            "semantic",
            "ollama",
            "memory",
            "contents",
        ],
        default="all",
        help="Which test to run",
    )
    parser.add_argument(
        "--db-path",
        default=os.path.expanduser("~/.auto-claude/memories"),
        help="Database path",
    )
    parser.add_argument(
        "--database",
        default="test_memory",
        help="Database name (use 'test_memory' for testing)",
    )

    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("  MEMORY SYSTEM TEST SUITE (LadybugDB)")
    print("=" * 60)

    # Configuration check
    print_header("0. Configuration Check")

    print(f"  Database path: {args.db_path}")
    print(f"  Database name: {args.database}")
    print()

    # Check environment
    graphiti_enabled = os.environ.get("GRAPHITI_ENABLED", "").lower() == "true"
    embedder_provider = os.environ.get("GRAPHITI_EMBEDDER_PROVIDER", "")

    print_result("GRAPHITI_ENABLED", str(graphiti_enabled), graphiti_enabled)
    print_result(
        "GRAPHITI_EMBEDDER_PROVIDER",
        embedder_provider or "(not set)",
        bool(embedder_provider),
    )

    if embedder_provider == "ollama":
        ollama_model = os.environ.get("OLLAMA_EMBEDDING_MODEL", "")
        ollama_dim = os.environ.get("OLLAMA_EMBEDDING_DIM", "")
        print_result(
            "OLLAMA_EMBEDDING_MODEL", ollama_model or "(not set)", bool(ollama_model)
        )
        print_result(
            "OLLAMA_EMBEDDING_DIM", ollama_dim or "(not set)", bool(ollama_dim)
        )
    elif embedder_provider == "openai":
        has_key = bool(os.environ.get("OPENAI_API_KEY"))
        print_result("OPENAI_API_KEY", "Set" if has_key else "Not set", has_key)

    # Run tests based on selection
    test = args.test
    group_id = None

    if test in ["all", "connection"]:
        await test_ladybugdb_connection(args.db_path, args.database)

    if test in ["all", "ollama"]:
        await test_ollama_embeddings()

    if test in ["all", "save"]:
        _, group_id = await test_save_episode(args.db_path, args.database)
        if group_id:
            print("\n  Waiting 2 seconds for embedding processing...")
            await asyncio.sleep(2)

    if test in ["all", "keyword"]:
        await test_keyword_search(args.db_path, args.database)

    if test in ["all", "semantic"]:
        await test_semantic_search(
            args.db_path, args.database, group_id or "ladybug_test_group"
        )

    if test in ["all", "memory"]:
        await test_graphiti_memory_class(args.db_path, args.database)

    if test in ["all", "contents"]:
        await test_database_contents(args.db_path, args.database)

    print_header("TEST SUMMARY")
    print("  Tests completed. Check the results above for any failures.")
    print()
    print("  Quick commands:")
    print("    # Run all tests:")
    print("    python integrations/graphiti/run_graphiti_memory_test.py")
    print()
    print("    # Test just Ollama embeddings:")
    print("    python integrations/graphiti/run_graphiti_memory_test.py --test ollama")
    print()
    print("    # Test with production database:")
    print(
        "    python integrations/graphiti/run_graphiti_memory_test.py --database auto_claude_memory"
    )
    print()


if __name__ == "__main__":
    asyncio.run(main())
