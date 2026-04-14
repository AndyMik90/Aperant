from pathlib import Path
from unittest.mock import patch

from core.codex_cli_client import CodexCLIClient


def test_build_command_uses_windows_command_builder_and_reasoning_override(
    monkeypatch, tmp_path: Path
):
    captured: dict[str, object] = {}

    def fake_build_windows_command(cli_path: str, args: list[str]) -> list[str]:
        captured["cli_path"] = cli_path
        captured["args"] = args
        return ["wrapped-command"]

    monkeypatch.setenv(
        "APERANT_CODEX_CLI_PATH", r"C:\Users\topem\AppData\Roaming\npm\codex.cmd"
    )

    with patch(
        "core.codex_cli_client.build_windows_command",
        side_effect=fake_build_windows_command,
    ):
        client = CodexCLIClient(
            project_dir=tmp_path,
            spec_dir=tmp_path,
            model="gpt-5.4",
            cwd=tmp_path,
            reasoning_effort="xhigh",
        )

        command = client._build_command()

    assert command == ["wrapped-command"]
    assert captured["cli_path"] == r"C:\Users\topem\AppData\Roaming\npm\codex.cmd"
    assert captured["args"]
    assert "model_reasoning_effort=xhigh" in captured["args"]
