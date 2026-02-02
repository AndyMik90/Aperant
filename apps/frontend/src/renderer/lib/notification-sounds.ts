import type { NotificationSoundType } from '@shared/types';

/**
 * Play a notification sound using Web Audio API.
 * This is a safe, cross-platform alternative to shell.beep() which crashes on some Linux systems.
 *
 * @param soundType - The type of sound to play
 */
export function playNotificationSound(soundType: NotificationSoundType = 'chime'): void {
  try {
    const AudioContextClass = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioContext = new AudioContextClass();

    const playTone = (
      freq: number,
      start: number,
      duration: number,
      type: OscillatorType = 'sine',
      volume = 0.3
    ) => {
      const osc = audioContext.createOscillator();
      const g = audioContext.createGain();
      osc.connect(g);
      g.connect(audioContext.destination);
      osc.frequency.value = freq;
      osc.type = type;
      g.gain.setValueAtTime(volume, audioContext.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + start + duration);
      osc.start(audioContext.currentTime + start);
      osc.stop(audioContext.currentTime + start + duration);
    };

    switch (soundType) {
      case 'chime':
        // Two-tone doorbell sound (default)
        playTone(880, 0, 0.15);
        playTone(660, 0.12, 0.2);
        break;
      case 'ping':
        // Quick high-pitched single tone
        playTone(1200, 0, 0.1, 'sine', 0.25);
        break;
      case 'pulse':
        // Low vibration-like double pulse
        playTone(200, 0, 0.08, 'square', 0.2);
        playTone(200, 0.12, 0.08, 'square', 0.2);
        break;
      case 'blip':
        // Short electronic blip
        playTone(600, 0, 0.05, 'triangle', 0.3);
        playTone(800, 0.05, 0.05, 'triangle', 0.25);
        break;
      case 'soft': {
        // Gentle fade-in/out tone
        const osc = audioContext.createOscillator();
        const g = audioContext.createGain();
        osc.connect(g);
        g.connect(audioContext.destination);
        osc.frequency.value = 440;
        osc.type = 'sine';
        g.gain.setValueAtTime(0.01, audioContext.currentTime);
        g.gain.exponentialRampToValueAtTime(0.2, audioContext.currentTime + 0.1);
        g.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        osc.start();
        osc.stop(audioContext.currentTime + 0.3);
        break;
      }
      default:
        // Fallback: simple beep
        playTone(800, 0, 0.15);
    }

    // Cleanup after sounds finish
    setTimeout(() => audioContext.close(), 500);
  } catch (err) {
    console.error('[NotificationSound] Failed to play sound:', err);
  }
}
