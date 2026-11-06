// src/utils/audioPreview.ts
// Procedural WebAudio & PCM WAV loop synthesizer for KeepIt soundtrack previews.
// Generates licensed, royalty-free ambient synth/piano/lo-fi chord loops tailored to each
// track's BPM and tonal signature, with single-track playback exclusivity and unmount cleanup.

import { MusicTrackAttachment } from '@/types/database';

type StopListener = (activeTrackId: string | null) => void;

const trackChordsHz: Record<string, readonly number[][]> = {
  trk_sunset_lover: [
    [261.63, 329.63, 392.0, 493.88], // Cmaj7
    [220.0, 261.63, 329.63, 392.0], // Am7
    [174.61, 220.0, 261.63, 349.23], // Fmaj7
    [196.0, 246.94, 293.66, 392.0], // G6
  ],
  trk_coffee_breath: [
    [293.66, 369.99, 440.0, 554.37], // Dmaj7
    [246.94, 293.66, 369.99, 440.0], // Bm7
    [196.0, 246.94, 293.66, 369.99], // Gmaj7
    [220.0, 277.18, 329.63, 440.0], // A
  ],
  trk_midnight_city: [
    [233.08, 293.66, 349.23, 466.16], // Bb
    [196.0, 233.08, 293.66, 392.0], // Gm7
    [155.56, 196.0, 233.08, 311.13], // Ebmaj7
    [174.61, 220.0, 261.63, 349.23], // F
  ],
  trk_golden_hour: [
    [329.63, 415.3, 493.88, 622.25], // Emaj7
    [277.18, 329.63, 415.3, 493.88], // C#m7
    [220.0, 277.18, 329.63, 415.3], // Amaj7
    [246.94, 311.13, 369.99, 493.88], // B
  ],
  trk_tokyo_rain: [
    [261.63, 311.13, 392.0, 466.16], // Cm7
    [207.65, 261.63, 311.13, 392.0], // Abmaj7
    [174.61, 207.65, 261.63, 349.23], // Fm7
    [196.0, 246.94, 293.66, 349.23], // G7
  ],
  trk_best_part: [
    [293.66, 369.99, 440.0, 554.37], // Dmaj7
    [220.0, 261.63, 329.63, 392.0], // Am7
    [196.0, 246.94, 293.66, 369.99], // Gmaj7
    [233.08, 293.66, 349.23, 440.0], // Bbmaj7
  ],
};

let activeTrackId: string | null = null;
let stepIntervalId: number | null = null;
let sharedAudioCtx: AudioContext | null = null;
let htmlAudioElement: HTMLAudioElement | null = null;
const listeners = new Set<StopListener>();

function notifyListeners() {
  for (const fn of listeners) {
    fn(activeTrackId);
  }
}

export function subscribeMusicPreviewState(listener: StopListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveMusicPreviewTrackId(): string | null {
  return activeTrackId;
}

/**
 * Generates a self-contained 16-bit mono PCM WAV data URI for platforms/contexts
 * that use HTMLAudioElement fallback.
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeUint8ToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : '=';
  }
  return out;
}

export function buildSynthesizedTrackWavDataUri(track: MusicTrackAttachment): string {
  const sampleRate = 11025;
  const durationSeconds = 4;
  const totalSamples = sampleRate * durationSeconds;
  const chords = trackChordsHz[track.id] ?? trackChordsHz.trk_sunset_lover;
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const chordIdx = Math.floor(t) % chords.length;
    const chord = chords[chordIdx];
    const localT = t % 1;
    const env = Math.min(1, localT * 12) * Math.exp(-localT * 2.4);
    let sample = 0;
    for (const freq of chord) {
      sample += Math.sin(2 * Math.PI * freq * t);
    }
    const normalized = Math.max(-1, Math.min(1, (sample / chord.length) * env * 0.45));
    view.setInt16(44 + i * 2, Math.round(normalized * 32767), true);
  }

  const bytes = new Uint8Array(buffer);
  const base64 = encodeUint8ToBase64(bytes);
  return `data:audio/wav;base64,${base64}`;
}

export function stopMusicPreview(): void {
  if (stepIntervalId !== null) {
    clearInterval(stepIntervalId);
    stepIntervalId = null;
  }
  if (htmlAudioElement) {
    try {
      htmlAudioElement.pause();
      htmlAudioElement.src = '';
    } catch {
      // Ignore cleanup errors
    }
    htmlAudioElement = null;
  }
  if (activeTrackId !== null) {
    activeTrackId = null;
    notifyListeners();
  }
}

export function toggleMusicTrackPreview(track: MusicTrackAttachment): boolean {
  if (!track?.id) return false;

  if (activeTrackId === track.id) {
    stopMusicPreview();
    return false;
  }

  stopMusicPreview();
  activeTrackId = track.id;
  notifyListeners();

  const chords = trackChordsHz[track.id] ?? trackChordsHz.trk_sunset_lover;
  const bpm = track.bpm ?? 92;
  const beatMs = Math.max(380, Math.round((60_000 / bpm) * 2));

  const AudioCtxCtor: typeof AudioContext | undefined =
    typeof AudioContext === 'function' ? AudioContext : undefined;

  if (AudioCtxCtor) {
    try {
      if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
        sharedAudioCtx = new AudioCtxCtor();
      }
      if (sharedAudioCtx.state === 'suspended') {
        void sharedAudioCtx.resume().catch(() => {});
      }

      let step = 0;
      const triggerChord = () => {
        if (!sharedAudioCtx || activeTrackId !== track.id) return;
        const now = sharedAudioCtx.currentTime;
        const chord = chords[step % chords.length];
        step += 1;

        for (let idx = 0; idx < chord.length; idx += 1) {
          const osc = sharedAudioCtx.createOscillator();
          const gain = sharedAudioCtx.createGain();
          osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
          osc.frequency.setValueAtTime(chord[idx], now);

          const startOffset = idx * 0.035;
          gain.gain.setValueAtTime(0.0001, now + startOffset);
          gain.gain.linearRampToValueAtTime(0.06, now + startOffset + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0008, now + startOffset + beatMs / 1000);

          osc.connect(gain);
          gain.connect(sharedAudioCtx.destination);
          osc.start(now + startOffset);
          osc.stop(now + startOffset + beatMs / 1000 + 0.04);
        }
      };

      triggerChord();
      stepIntervalId = setInterval(triggerChord, beatMs) as unknown as number;
      return true;
    } catch {
      // Fall through to WAV data URI audio element
    }
  }

  if (typeof Audio !== 'undefined') {
    try {
      const wavUri = buildSynthesizedTrackWavDataUri(track);
      const audio = new Audio(wavUri);
      audio.loop = true;
      htmlAudioElement = audio;
      void audio.play().catch(() => {});
      return true;
    } catch {
      // Continue with timer fallback
    }
  }

  return true;
}
