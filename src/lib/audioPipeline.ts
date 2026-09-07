// Production Android AudioManager & WebRTC Audio Routing Pipeline
// Implements Android 12+ (API 31-35) CommunicationDevice paradigm with host OS audio hardware detection

import {
  AudioOutputRoute,
  AudioRoutingTelemetry,
  SimulatedBluetoothDevice,
} from '../types';

let sharedAudioContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    sharedAudioContext = new AudioCtx();
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}

export function unlockAudioContext(): void {
  const ctx = getSharedAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

/**
 * Checks system audio devices for connected Bluetooth hardware
 */
async function detectHostBluetoothDevices(): Promise<{
  hasBluetooth: boolean;
  deviceName?: string;
  deviceId?: string;
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { hasBluetooth: false };
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const btKeywords = [
      'bluetooth',
      'headset',
      'buds',
      'airpod',
      'wireless',
      'hands-free',
      'wh-',
      'wf-',
      'freebuds',
      'galaxy',
      'pixel buds',
      'hfp',
      'le audio',
    ];

    const btDevice = devices.find((d) => {
      const label = d.label.toLowerCase();
      return (
        (d.kind === 'audiooutput' || d.kind === 'audioinput') &&
        btKeywords.some((k) => label.includes(k))
      );
    });

    if (btDevice) {
      return {
        hasBluetooth: true,
        deviceName: btDevice.label || 'Bluetooth Headset (LE Audio / SCO)',
        deviceId: btDevice.deviceId,
      };
    }
  } catch (err) {
    console.debug('[AudioPipeline] Device enumeration notice:', err);
  }

  return { hasBluetooth: false };
}

/**
 * DeviceAudioRouteManager
 * Mirrors Android AudioManager & CommunicationDevice API (Android 12+ / Android 13-15 API 31-35).
 * Responds to real host Bluetooth connections and manages VoIP communication routing (Earpiece, Speaker, Bluetooth).
 */
export class DeviceAudioRouteManager {
  private deviceId: string;
  private activeRoute: AudioOutputRoute = 'EARPIECE';
  private remoteStream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private gainNode: GainNode | null = null;
  private audioFocus: 'AUDIOFOCUS_GAIN_TRANSIENT' | 'AUDIOFOCUS_NONE' | 'AUDIOFOCUS_LOSS' = 'AUDIOFOCUS_NONE';
  private audioMode: 'MODE_IN_COMMUNICATION' | 'MODE_NORMAL' = 'MODE_NORMAL';
  private remotePlaybackState: AudioRoutingTelemetry['remoteAudioPlaybackState'] = 'IDLE';
  private telemetryListeners: Set<(telemetry: AudioRoutingTelemetry) => void> = new Set();
  
  // Real host Bluetooth state
  private isRealBluetoothConnected: boolean = false;
  private hostBluetoothDeviceName: string = '';
  private hostBluetoothDeviceId: string = '';

  constructor(deviceId: string) {
    this.deviceId = deviceId;
    this.initHostDeviceDetection();
  }

  private async initHostDeviceDetection() {
    await this.checkHostAudioDevices();

    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        console.log(`[Android AudioManager (${this.deviceId})] OS Audio devicechange detected`);
        const prevBt = this.isRealBluetoothConnected;
        await this.checkHostAudioDevices();
        
        if (!prevBt && this.isRealBluetoothConnected) {
          // Real Bluetooth connected -> automatically switch active route to Bluetooth
          this.printDebugLog(`Bluetooth headset connected to OS: ${this.hostBluetoothDeviceName} -> Auto-routing`);
          if (this.audioMode === 'MODE_IN_COMMUNICATION') {
            this.setRoute('BLUETOOTH');
          }
        } else if (prevBt && !this.isRealBluetoothConnected) {
          // Real Bluetooth disconnected -> fallback to earpiece
          this.printDebugLog('Bluetooth headset disconnected from OS -> Falling back to Earpiece');
          if (this.activeRoute === 'BLUETOOTH') {
            this.setRoute('EARPIECE');
          }
        }
      });
    }
  }

  public async checkHostAudioDevices() {
    const btInfo = await detectHostBluetoothDevices();
    this.isRealBluetoothConnected = btInfo.hasBluetooth;
    this.hostBluetoothDeviceName = btInfo.deviceName || 'Bluetooth Headset';
    this.hostBluetoothDeviceId = btInfo.deviceId || '';
    this.notifyTelemetry();
  }

  public subscribeTelemetry(listener: (telemetry: AudioRoutingTelemetry) => void): () => void {
    this.telemetryListeners.add(listener);
    listener(this.getTelemetry());
    return () => {
      this.telemetryListeners.delete(listener);
    };
  }

  private notifyTelemetry() {
    const data = this.getTelemetry();
    this.telemetryListeners.forEach((fn) => fn(data));
  }

  public getTelemetry(): AudioRoutingTelemetry {
    const availableDevices: string[] = [
      'TYPE_BUILTIN_EARPIECE (Handset Receiver)',
      'TYPE_BUILTIN_SPEAKER (Loudspeaker)',
    ];

    if (this.isRealBluetoothConnected) {
      availableDevices.unshift(`TYPE_BLE_HEADSET (${this.hostBluetoothDeviceName})`);
    }

    let selectedDevice = 'TYPE_BUILTIN_EARPIECE (Handset Receiver)';
    if (this.activeRoute === 'SPEAKER') {
      selectedDevice = 'TYPE_BUILTIN_SPEAKER (Loudspeaker)';
    } else if (this.activeRoute === 'BLUETOOTH') {
      selectedDevice = this.isRealBluetoothConnected
        ? `TYPE_BLE_HEADSET (${this.hostBluetoothDeviceName})`
        : 'TYPE_BLUETOOTH_SCO (Bluetooth Communication Device)';
    }

    return {
      availableDevices,
      selectedDevice,
      currentAudioMode: this.audioMode,
      bluetoothConnectionState: this.isRealBluetoothConnected
        ? 'STATE_CONNECTED'
        : 'STATE_DISCONNECTED',
      bluetoothDeviceName: this.isRealBluetoothConnected
        ? this.hostBluetoothDeviceName
        : undefined,
      audioFocusState: this.audioFocus,
      remoteAudioPlaybackState: this.remotePlaybackState,
      sampleRate: 48000,
      activeRoute: this.activeRoute,
      isRealBluetoothDetected: this.isRealBluetoothConnected,
      lastUpdated: Date.now(),
    };
  }

  private printDebugLog(action: string) {
    const t = this.getTelemetry();
    console.log(
      `%c[Android AudioManager (${this.deviceId})] ${action}`,
      'color: #0284c7; font-weight: bold;',
      {
        'Available Communication Devices': t.availableDevices,
        'Selected Communication Device': t.selectedDevice,
        'AudioDeviceInfo Type':
          this.activeRoute === 'BLUETOOTH'
            ? 'TYPE_BLE_HEADSET'
            : this.activeRoute === 'SPEAKER'
            ? 'TYPE_BUILTIN_SPEAKER'
            : 'TYPE_BUILTIN_EARPIECE',
        'Current Audio Mode': t.currentAudioMode,
        'Bluetooth State': t.bluetoothConnectionState,
        'Audio Focus State': t.audioFocusState,
        'WebRTC Remote Audio Track': this.remoteStream
          ? `${this.remoteStream.getAudioTracks().length} active track(s)`
          : 'None',
        'WebRTC Remote Audio Playback State': t.remoteAudioPlaybackState,
        'Active Route': t.activeRoute,
      }
    );
  }

  /**
   * Request audio focus and set MODE_IN_COMMUNICATION on call start
   */
  public startCallAudioSession() {
    this.audioMode = 'MODE_IN_COMMUNICATION';
    this.audioFocus = 'AUDIOFOCUS_GAIN_TRANSIENT';

    // If Bluetooth headset is connected to phone, prefer Bluetooth automatically
    if (this.isRealBluetoothConnected) {
      this.activeRoute = 'BLUETOOTH';
    } else if (this.activeRoute === 'BLUETOOTH') {
      this.activeRoute = 'EARPIECE';
    }

    this.printDebugLog('startCallAudioSession -> MODE_IN_COMMUNICATION & AUDIOFOCUS_GAIN_TRANSIENT acquired');
    this.applyAudioRoutingDsp();
    this.notifyTelemetry();
  }

  /**
   * End call audio session: restores MODE_NORMAL and abandons audio focus
   */
  public endCallAudioSession() {
    this.audioMode = 'MODE_NORMAL';
    this.audioFocus = 'AUDIOFOCUS_NONE';
    this.remotePlaybackState = 'IDLE';
    this.printDebugLog('endCallAudioSession -> Restored MODE_NORMAL & abandoned audio focus');
    this.notifyTelemetry();
  }

  /**
   * Attach remote MediaStream to audio element and configure Web Audio routing
   */
  public async attachRemoteStream(
    audioEl: HTMLAudioElement | HTMLVideoElement,
    stream: MediaStream
  ): Promise<boolean> {
    this.audioEl = audioEl as HTMLAudioElement;
    this.remoteStream = stream;

    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach((t) => {
      t.enabled = true;
    });

    try {
      this.audioEl.srcObject = stream;
      // Web Audio Graph will handle the master acoustic output; mute HTML tag to avoid double-echo
      this.audioEl.muted = true;
      this.audioEl.volume = 1.0;
      await this.audioEl.play().catch((err) => {
        console.warn(`[AudioPipeline-${this.deviceId}] Auto-play prompt:`, err);
      });
      this.remotePlaybackState = 'PLAYING';
    } catch (err) {
      console.warn(`[AudioPipeline-${this.deviceId}] Attach stream notice:`, err);
    }

    this.setupWebAudioRouting();
    this.applyAudioRoutingDsp();
    this.syncSinkId();
    this.printDebugLog('attachRemoteStream -> WebRTC track connected and routed');
    this.notifyTelemetry();
    return true;
  }

  private syncSinkId() {
    const ctx = getSharedAudioContext();
    const targetSinkId = (this.activeRoute === 'BLUETOOTH' && this.hostBluetoothDeviceId)
      ? this.hostBluetoothDeviceId
      : '';

    // Route AudioContext to target sink if supported
    if ((ctx as any).setSinkId) {
      (ctx as any).setSinkId(targetSinkId).catch((err: any) => {
        console.debug(`[AudioPipeline-${this.deviceId}] AudioContext setSinkId notice:`, err);
      });
    }

    // Route HTML Audio element to target sink if supported
    if (this.audioEl && (this.audioEl as any).setSinkId) {
      (this.audioEl as any).setSinkId(targetSinkId).catch((err: any) => {
        console.debug(`[AudioPipeline-${this.deviceId}] HTMLAudioElement setSinkId notice:`, err);
      });
    }
  }

  private setupWebAudioRouting() {
    if (!this.remoteStream) return;
    try {
      const ctx = getSharedAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (!this.sourceNode && this.remoteStream.getAudioTracks().length > 0) {
        this.sourceNode = ctx.createMediaStreamSource(this.remoteStream);
        this.filterNode = ctx.createBiquadFilter();
        if (ctx.createStereoPanner) {
          this.pannerNode = ctx.createStereoPanner();
        }
        this.gainNode = ctx.createGain();

        this.sourceNode.connect(this.filterNode);
        if (this.pannerNode) {
          this.filterNode.connect(this.pannerNode);
          this.pannerNode.connect(this.gainNode);
        } else {
          this.filterNode.connect(this.gainNode);
        }
        // Connect to destination to ensure audible playback
        this.gainNode.connect(ctx.destination);
      }
    } catch (e) {
      console.debug(`[AudioPipeline-${this.deviceId}] Web Audio Graph setup notice:`, e);
    }
  }

  /**
   * Applies acoustic characteristic DSP based on selected route
   * WITHOUT interrupting or restarting the WebRTC MediaStream
   */
  private applyAudioRoutingDsp() {
    if (!this.filterNode || !this.gainNode) return;
    const ctx = getSharedAudioContext();

    if (this.activeRoute === 'BLUETOOTH') {
      // Bluetooth wideband / BLE LE Audio profile: High-fidelity voice enhancement
      this.filterNode.type = 'peaking';
      this.filterNode.frequency.setValueAtTime(3000, ctx.currentTime);
      this.filterNode.Q.setValueAtTime(1.4, ctx.currentTime);
      this.filterNode.gain.setValueAtTime(4.0, ctx.currentTime);
      if (this.pannerNode) {
        this.pannerNode.pan.setValueAtTime(0.04, ctx.currentTime);
      }
      this.gainNode.gain.setValueAtTime(1.1, ctx.currentTime);
      this.remotePlaybackState = 'ROUTING_TO_BLUETOOTH';
    } else if (this.activeRoute === 'SPEAKER') {
      // Loudspeaker acoustic profile: open bass resonance, wide projection
      this.filterNode.type = 'highpass';
      this.filterNode.frequency.setValueAtTime(180, ctx.currentTime);
      if (this.pannerNode) {
        this.pannerNode.pan.setValueAtTime(0, ctx.currentTime);
      }
      this.gainNode.gain.setValueAtTime(1.25, ctx.currentTime);
      this.remotePlaybackState = 'ROUTING_TO_SPEAKER';
    } else {
      // Handset Earpiece profile: standard bandpass voice telephony (300Hz - 3.4kHz)
      this.filterNode.type = 'bandpass';
      this.filterNode.frequency.setValueAtTime(1800, ctx.currentTime);
      this.filterNode.Q.setValueAtTime(0.7, ctx.currentTime);
      if (this.pannerNode) {
        this.pannerNode.pan.setValueAtTime(0, ctx.currentTime);
      }
      this.gainNode.gain.setValueAtTime(0.9, ctx.currentTime);
      this.remotePlaybackState = 'ROUTING_TO_EARPIECE';
    }

    setTimeout(() => {
      this.remotePlaybackState = 'PLAYING';
      this.notifyTelemetry();
    }, 250);
  }

  /**
   * Switch communication device route (Earpiece, Speaker, Bluetooth)
   */
  public setRoute(route: AudioOutputRoute) {
    this.activeRoute = route;
    this.syncSinkId();
    this.applyAudioRoutingDsp();
    this.printDebugLog(`setCommunicationDevice -> Selected ${route}`);
    this.notifyTelemetry();
  }

  public getActiveRoute(): AudioOutputRoute {
    return this.activeRoute;
  }

  public isBluetoothAvailable(): boolean {
    return this.isRealBluetoothConnected;
  }

  public getBluetoothDeviceName(): string {
    return this.hostBluetoothDeviceName;
  }
}

// Global registry of per-device audio managers
const deviceManagers = new Map<string, DeviceAudioRouteManager>();

export function getDeviceAudioRouteManager(deviceId: string): DeviceAudioRouteManager {
  let mgr = deviceManagers.get(deviceId);
  if (!mgr) {
    mgr = new DeviceAudioRouteManager(deviceId);
    deviceManagers.set(deviceId, mgr);
  }
  return mgr;
}

/**
 * Ensures an HTMLAudioElement or HTMLVideoElement has its audio stream attached, unlocked, and actively playing.
 */
export async function attachAndPlayRemoteAudio(
  audioEl: HTMLAudioElement | HTMLVideoElement,
  stream: MediaStream,
  label: string
): Promise<boolean> {
  if (!audioEl) {
    console.warn(`[AudioPipeline] ${label}: Audio element reference is null`);
    return false;
  }

  const deviceId = label.includes('User_A') || label.includes('user_a') ? 'user_a' : 'user_b';
  const manager = getDeviceAudioRouteManager(deviceId);
  return await manager.attachRemoteStream(audioEl, stream);
}
