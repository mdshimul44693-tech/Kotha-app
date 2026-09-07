// Web Audio API Ringtone & Telecom Sound Synthesizer (Realistic Phone Ringtones)

let audioCtx: AudioContext | null = null;
let incomingRingtoneTimer: any = null;
let outgoingRingtoneTimer: any = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// User-gesture helper to unlock Web Audio in browsers
export function unlockAudioContext() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch {}
}

/**
 * Plays a realistic musical mobile incoming ringtone through the phone speaker.
 * Loops continuously until stopRingtone() is called.
 */
export function playIncomingRingtone() {
  stopRingtone();
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const playMelodyChord = () => {
      if (!audioCtx) return;
      const now = ctx.currentTime;

      // Realistic Polyphonic Chime Melodic Ringtone (Marimba/Digital Phone style)
      // Notes: E5 (659Hz), G#5 (830Hz), B5 (987Hz), E6 (1318Hz)
      const notes = [
        { freq: 659.25, timeOffset: 0.0, dur: 0.35, gain: 0.18 },
        { freq: 830.61, timeOffset: 0.18, dur: 0.35, gain: 0.18 },
        { freq: 987.77, timeOffset: 0.36, dur: 0.35, gain: 0.20 },
        { freq: 1318.51, timeOffset: 0.54, dur: 0.5, gain: 0.22 },
        { freq: 987.77, timeOffset: 0.90, dur: 0.35, gain: 0.18 },
        { freq: 1318.51, timeOffset: 1.08, dur: 0.6, gain: 0.22 },
      ];

      notes.forEach(({ freq, timeOffset, dur, gain: targetGain }) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + timeOffset);

        gainNode.gain.setValueAtTime(0.001, now + timeOffset);
        gainNode.gain.linearRampToValueAtTime(targetGain, now + timeOffset + 0.03);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + timeOffset + dur);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(now + timeOffset);
        osc.stop(now + timeOffset + dur + 0.05);
      });
    };

    // Play first burst immediately
    playMelodyChord();
    // Repeat every 2.5 seconds until answered or declined
    incomingRingtoneTimer = setInterval(playMelodyChord, 2400);
  } catch (e) {
    console.warn('Incoming ringtone playback notice:', e);
  }
}

/**
 * Plays standard outgoing telecom ringing tone ("tuuut... tuuut...") for the caller.
 * Loops continuously until stopRingtone() is called.
 */
export function playOutgoingBeep() {
  stopRingtone();
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const playDialTonePulse = () => {
      if (!audioCtx) return;
      const now = ctx.currentTime;

      // Standard telecom ringback tone (440Hz + 480Hz dual frequency)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(480, now);

      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.linearRampToValueAtTime(0.12, now + 0.05);
      gainNode.gain.setValueAtTime(0.12, now + 1.2);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.35);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.4);
      osc2.stop(now + 1.4);
    };

    playDialTonePulse();
    outgoingRingtoneTimer = setInterval(playDialTonePulse, 3000);
  } catch (e) {
    console.warn('Outgoing ringtone playback notice:', e);
  }
}

/**
 * Call termination sound (short descending disconnect beep)
 */
export function playCallEndSound() {
  stopRingtone();
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.28);

    gainNode.gain.setValueAtTime(0.15, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {
    console.warn('End call sound notice:', e);
  }
}

/**
 * Stops any active incoming or outgoing ringtones immediately
 */
export function stopRingtone() {
  if (incomingRingtoneTimer) {
    clearInterval(incomingRingtoneTimer);
    incomingRingtoneTimer = null;
  }
  if (outgoingRingtoneTimer) {
    clearInterval(outgoingRingtoneTimer);
    outgoingRingtoneTimer = null;
  }
}

