from unittest.mock import patch

from core.platform import build_windows_command


def test_build_windows_command_uses_separate_cmd_tokens_for_batch_files():
    with patch("core.platform.is_windows", return_value=True), patch(
        "core.platform.get_comspec_path",
        return_value=r"C:\Windows\System32\cmd.exe",
    ):
        command = build_windows_command(
            r"C:\Users\topem\AppData\Roaming\npm\codex.cmd",
            ["exec", "--json", "-m", "gpt-5.4"],
        )

    assert command == [
        r"C:\Windows\System32\cmd.exe",
        "/d",
        "/c",
        r"C:\Users\topem\AppData\Roaming\npm\codex.cmd",
        "exec",
        "--json",
        "-m",
        "gpt-5.4",
    ]


def test_build_windows_command_keeps_exe_launches_direct():
    with patch("core.platform.is_windows", return_value=True):
        command = build_windows_command(
            r"C:\Users\topem\AppData\Local\Programs\OpenAI\codex.exe",
            ["exec", "--json"],
        )

    assert command == [
        r"C:\Users\topem\AppData\Local\Programs\OpenAI\codex.exe",
        "exec",
        "--json",
    ]
