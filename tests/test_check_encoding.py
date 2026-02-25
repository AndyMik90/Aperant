"""Tests for the encoding check script."""

import tempfile
from pathlib import Path

# Import the checker
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from check_encoding import EncodingChecker


class TestEncodingChecker:
    """Test the EncodingChecker class."""

    def test_detects_open_without_encoding(self):
        """Should detect open() calls without encoding parameter."""
        code = '''
def read_file(path):
    with open(path) as f:
        return f.read()
'''
        # Create temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is False
            assert len(checker.issues) == 1
            assert "open() without encoding" in checker.issues[0]
        finally:
            temp_path.unlink()

    def test_allows_open_with_encoding(self):
        """Should allow open() calls with encoding parameter."""
        code = '''
def read_file(path):
    with open(path, encoding="utf-8") as f:
        return f.read()
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is True
            assert len(checker.issues) == 0
        finally:
            temp_path.unlink()

    def test_allows_binary_mode_without_encoding(self):
        """Should allow binary mode without encoding (correct behavior)."""
        code = '''
def read_file(path):
    with open(path, "rb") as f:
        return f.read()
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is True
            assert len(checker.issues) == 0
        finally:
            temp_path.unlink()

    def test_allows_write_binary_mode_without_encoding(self):
        """Should allow write binary mode (wb) without encoding."""
        code = '''
def write_file(path, data):
    with open(path, "wb") as f:
        f.write(data)
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is True
            assert len(checker.issues) == 0
        finally:
            temp_path.unlink()

    def test_allows_append_binary_mode_without_encoding(self):
        """Should allow append binary mode (ab) without encoding."""
        code = '''
def append_file(path, data):
    with open(path, "ab") as f:
        f.write(data)
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is True
            assert len(checker.issues) == 0
        finally:
            temp_path.unlink()

    def test_detects_text_write_mode_without_encoding(self):
        """Should detect text write mode (w) without encoding."""
        code = '''
def write_file(path, content):
    with open(path, "w") as f:
        f.write(content)
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is False
            assert len(checker.issues) == 1
            assert "open() without encoding" in checker.issues[0]
        finally:
            temp_path.unlink()

    def test_detects_path_read_text_without_encoding(self):
        """Should detect Path.read_text() without encoding."""
        code = '''
from pathlib import Path

def read_file(path):
    return Path(path).read_text()
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is False
            assert len(checker.issues) == 1
            assert "read_text() without encoding" in checker.issues[0]
        finally:
            temp_path.unlink()

    def test_detects_path_write_text_without_encoding(self):
        """Should detect Path.write_text() without encoding."""
        code = '''
from pathlib import Path

def write_file(path, content):
    Path(path).write_text(content)
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is False
            assert len(checker.issues) == 1
            assert "write_text() without encoding" in checker.issues[0]
        finally:
            temp_path.unlink()

    def test_detects_json_load_without_encoding(self):
        """Should detect json.load(open()) without encoding in open()."""
        code = '''
import json

def read_json(path):
    with open(path) as f:
        return json.load(f)
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is False
            assert len(checker.issues) == 1
            # Detects the open() call without encoding
        finally:
            temp_path.unlink()

    def test_allows_path_read_text_with_encoding(self):
        """Should allow Path.read_text() with encoding parameter."""
        code = '''
from pathlib import Path

def read_file(path):
    return Path(path).read_text(encoding="utf-8")
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is True
            assert len(checker.issues) == 0
        finally:
            temp_path.unlink()

    def test_allows_path_write_text_with_encoding(self):
        """Should allow Path.write_text() with encoding parameter."""
        code = '''
from pathlib import Path

def write_file(path, content):
    Path(path).write_text(content, encoding="utf-8")
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is True
            assert len(checker.issues) == 0
        finally:
            temp_path.unlink()

    def test_allows_json_dump_with_encoding(self):
        """Should allow json.dump() with encoding in open()."""
        code = '''
import json

def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is True
            assert len(checker.issues) == 0
        finally:
            temp_path.unlink()

    def test_detects_json_dump_without_encoding(self):
        """Should detect json.dump() with open() without encoding."""
        code = '''
import json

def write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f)
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is False
            assert len(checker.issues) == 1
            # Detects the open() call without encoding
        finally:
            temp_path.unlink()

    def test_multiple_issues_in_single_file(self):
        """Should detect multiple encoding issues in a single file."""
        code = '''
from pathlib import Path

def process_files(input_path, output_path):
    # Missing encoding in open()
    with open(input_path) as f:
        content = f.read()

    # Missing encoding in Path.write_text()
    Path(output_path).write_text(content)

    return content
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            assert result is False
            assert len(checker.issues) == 2
        finally:
            temp_path.unlink()

    def test_skips_non_python_files(self):
        """Should skip files that are not Python files."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding="utf-8") as f:
            f.write("with open(path) as f: pass")
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            failed_count = checker.check_files([temp_path])

            assert failed_count == 0
            assert len(checker.issues) == 0
        finally:
            temp_path.unlink()

    def test_detects_encoding_with_spaces(self):
        """Should detect encoding parameter even with spaces around equals sign."""
        code = '''
def read_file(path):
    # This has spaces: encoding = "utf-8"
    with open(path, encoding = "utf-8") as f:
        return f.read()
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding="utf-8") as f:
            f.write(code)
            temp_path = Path(f.name)

        try:
            checker = EncodingChecker()
            result = checker.check_file(temp_path)

            # Should pass because word boundary regex handles spaces
            assert result is True
            assert len(checker.issues) == 0
        finally:
            temp_path.unlink()
