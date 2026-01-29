import { describe, expect, it } from 'vitest';
import { stripAnsiCodes } from '../ansi-sanitizer';

describe('stripAnsiCodes', () => {
  describe('CSI (Control Sequence Introducer) patterns', () => {
    it('should remove CSI color codes', () => {
      const input = '\x1b[90m[21:40:22.196]\x1b[0m \x1b[36m[DEBUG]\x1b[0m';
      const expected = '[21:40:22.196] [DEBUG]';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should remove SGR (Select Graphic Rendition) sequences', () => {
      const input = '\x1b[96mSending query to agent\x1b[0m';
      const expected = 'Sending query to agent';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should remove multiple consecutive CSI sequences', () => {
      const input = '\x1b[90m\x1b[1m\x1b[4mBold underlined text\x1b[0m';
      const expected = 'Bold underlined text';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle CSI with numeric parameters', () => {
      const input = '\x1b[38;5;123mTruecolor text\x1b[0m';
      const expected = 'Truecolor text';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle CSI with semicolon-separated parameters', () => {
      const input = '\x1b[1;3;4;32mMultiple styles\x1b[0m';
      const expected = 'Multiple styles';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should remove cursor movement sequences', () => {
      const input = 'Text\x1b[2K\x1b[1Gwith cursor codes';
      const expected = 'Textwith cursor codes';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle various CSI final characters', () => {
      const input = 'Text\x1b[A\x1b[B\x1b[C\x1b[D\x1b[K\x1b[2J';
      const expected = 'Text';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle CSI bracketed paste sequences', () => {
      // Bracketed paste start/end with non-alphabetic final byte (~)
      const input = '\x1b[200~pasted text\x1b[201~';
      const expected = 'pasted text';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle CSI with private mode parameters', () => {
      // Private mode sequences use ?<>=
      const input = '\x1b[?25lhide cursor\x1b[?25hshow cursor';
      const expected = 'hide cursorshow cursor';
      expect(stripAnsiCodes(input)).toBe(expected);
    });
  });

  describe('OSC (Operating System Command) patterns', () => {
    it('should remove OSC sequences with BEL terminator', () => {
      const input = 'Text\x1b]0;Window Title\x07with OSC';
      const expected = 'Textwith OSC';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should remove OSC sequences with ST terminator', () => {
      const input = 'Text\x1b]0;Window Title\x1b\\with OSC';
      const expected = 'Textwith OSC';
      expect(stripAnsiCodes(input)).toBe(expected);
    });
  });

  describe('real-world Python debug output examples', () => {
    it('should handle typical Python debug module output', () => {
      const input = '\x1b[90m[21:40:22.196]\x1b[0m \x1b[36m[DEBUG]\x1b[0m \x1b[96mSending query to agent\x1b[0m';
      const expected = '[21:40:22.196] [DEBUG] Sending query to agent';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle INFO level logs', () => {
      const input = '\x1b[90m[21:40:25.123]\x1b[0m \x1b[32m[INFO]\x1b[0m \x1b[96mProcessing request\x1b[0m';
      const expected = '[21:40:25.123] [INFO] Processing request';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle WARNING level logs', () => {
      const input = '\x1b[90m[21:40:28.456]\x1b[0m \x1b[33m[WARNING]\x1b[0m \x1b[96mRate limit approaching\x1b[0m';
      const expected = '[21:40:28.456] [WARNING] Rate limit approaching';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle ERROR level logs', () => {
      const input = '\x1b[90m[21:40:30.789]\x1b[0m \x1b[31m[ERROR]\x1b[0m \x1b[96mConnection failed\x1b[0m';
      const expected = '[21:40:30.789] [ERROR] Connection failed';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle multi-line debug output', () => {
      const input = '\x1b[90m[21:40:22.196]\x1b[0m \x1b[36m[DEBUG]\x1b[0m Starting process\n\x1b[90m[21:40:23.200]\x1b[0m \x1b[36m[DEBUG]\x1b[0m Process complete';
      const expected = '[21:40:22.196] [DEBUG] Starting process\n[21:40:23.200] [DEBUG] Process complete';
      expect(stripAnsiCodes(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should return empty string for empty input', () => {
      expect(stripAnsiCodes('')).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(stripAnsiCodes(undefined as unknown as string)).toBe('');
    });

    it('should return empty string for null input', () => {
      expect(stripAnsiCodes(null as unknown as string)).toBe('');
    });

    it('should pass through plain text without ANSI codes', () => {
      const input = 'Plain text without any escape sequences';
      const expected = 'Plain text without any escape sequences';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle strings with only ANSI codes', () => {
      const input = '\x1b[90m\x1b[0m\x1b[36m\x1b[0m';
      const expected = '';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle mixed ANSI and regular text', () => {
      const input = 'Start \x1b[90mgray\x1b[0m middle \x1b[31mred\x1b[0m end';
      const expected = 'Start gray middle red end';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle escape sequences at start of string', () => {
      const input = '\x1b[90m\x1b[36m[DEBUG]\x1b[0m Message';
      const expected = '[DEBUG] Message';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle escape sequences at end of string', () => {
      const input = 'Message\x1b[0m\x1b[0m\x1b[0m';
      const expected = 'Message';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should preserve newlines and other whitespace', () => {
      const input = '\x1b[90mLine 1\x1b[0m\n\x1b[90mLine 2\x1b[0m\t\x1b[90mLine 3\x1b[0m';
      const expected = 'Line 1\nLine 2\tLine 3';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle strings with special characters', () => {
      const input = '\x1b[90m[DEBUG]\x1b[0m Special: @#$%^&*()_+-=[]{}|;:,.<>?';
      const expected = '[DEBUG] Special: @#$%^&*()_+-=[]{}|;:,.<>?';
      expect(stripAnsiCodes(input)).toBe(expected);
    });
  });

  describe('common ANSI escape patterns', () => {
    it('should handle reset code', () => {
      expect(stripAnsiCodes('\x1b[0m')).toBe('');
    });

    it('should handle bold code', () => {
      expect(stripAnsiCodes('\x1b[1mbold\x1b[0m')).toBe('bold');
    });

    it('should handle dim code', () => {
      expect(stripAnsiCodes('\x1b[2mdim\x1b[0m')).toBe('dim');
    });

    it('should handle italic code', () => {
      expect(stripAnsiCodes('\x1b[3mitalic\x1b[0m')).toBe('italic');
    });

    it('should handle underline code', () => {
      expect(stripAnsiCodes('\x1b[4munderline\x1b[0m')).toBe('underline');
    });

    it('should handle foreground color codes (30-37, 90-97)', () => {
      expect(stripAnsiCodes('\x1b[30mblack\x1b[0m')).toBe('black');
      expect(stripAnsiCodes('\x1b[31mred\x1b[0m')).toBe('red');
      expect(stripAnsiCodes('\x1b[32mgreen\x1b[0m')).toBe('green');
      expect(stripAnsiCodes('\x1b[33myellow\x1b[0m')).toBe('yellow');
      expect(stripAnsiCodes('\x1b[34mblue\x1b[0m')).toBe('blue');
      expect(stripAnsiCodes('\x1b[35mmagenta\x1b[0m')).toBe('magenta');
      expect(stripAnsiCodes('\x1b[36mcyan\x1b[0m')).toBe('cyan');
      expect(stripAnsiCodes('\x1b[37mwhite\x1b[0m')).toBe('white');
      expect(stripAnsiCodes('\x1b[90mbright black\x1b[0m')).toBe('bright black');
      expect(stripAnsiCodes('\x1b[91mbright red\x1b[0m')).toBe('bright red');
      expect(stripAnsiCodes('\x1b[97mbright white\x1b[0m')).toBe('bright white');
    });

    it('should handle background color codes (40-47, 100-107)', () => {
      expect(stripAnsiCodes('\x1b[40m\x1b[37mon black bg\x1b[0m')).toBe('on black bg');
      expect(stripAnsiCodes('\x1b[41m\x1b[37mon red bg\x1b[0m')).toBe('on red bg');
    });
  });

  describe('integration test cases', () => {
    it('should handle actual roadmap progress message format', () => {
      const input = '\x1b[90m[21:40:22.196]\x1b[0m \x1b[36m[DEBUG]\x1b[0m \x1b[96mAnalyzing project structure\x1b[0m';
      const expected = '[21:40:22.196] [DEBUG] Analyzing project structure';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle ideation progress message format', () => {
      const input = '\x1b[90m[10:15:30.500]\x1b[0m \x1b[32m[INFO]\x1b[0m \x1b[96mGenerating research questions\x1b[0m';
      const expected = '[10:15:30.500] [INFO] Generating research questions';
      expect(stripAnsiCodes(input)).toBe(expected);
    });

    it('should handle multi-part log with timestamps and levels', () => {
      const input = '\x1b[90m[09:00:00.000]\x1b[0m \x1b[32m[INFO]\x1b[0m \x1b[96mStarting\x1b[0m\n\x1b[90m[09:00:01.000]\x1b[0m \x1b[33m[WARN]\x1b[0m \x1b[96mRetrying\x1b[0m\n\x1b[90m[09:00:02.000]\x1b[0m \x1b[32m[INFO]\x1b[0m \x1b[96mComplete\x1b[0m';
      const expected = '[09:00:00.000] [INFO] Starting\n[09:00:01.000] [WARN] Retrying\n[09:00:02.000] [INFO] Complete';
      expect(stripAnsiCodes(input)).toBe(expected);
    });
  });
});
