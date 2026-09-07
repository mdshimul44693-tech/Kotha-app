import {
  addCallerCandidate,
  addReceiverCandidate,
  subscribeToCallerCandidates,
  subscribeToReceiverCandidates,
  saveAnswerSDP,
  saveOfferSDP,
  updateCallStateInFirestore,
} from './firestoreService';
import { CallType, WebRtcCallSession } from '../types';

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

/**
 * Acquires live user media stream with real camera and microphone.
 * Starts front camera by default for video calls.
 * Prioritizes Bluetooth microphone hardware when available on the host device.
 * Never falls back to synthetic or fake audio. If permission is denied or hardware fails,
 * throws a descriptive error.
 */
export async function acquireMediaStream(
  callType: CallType,
  lowDataMode: boolean = false,
  role: 'caller' | 'receiver' = 'caller',
  facingMode: 'user' | 'environment' = 'user'
): Promise<MediaStream> {
  let idealAudioDeviceId: string | undefined = undefined;

  // Check if host system has a connected Bluetooth audio input device
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
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
      const btInput = devices.find(
        (d) =>
          d.kind === 'audioinput' &&
          btKeywords.some((k) => d.label.toLowerCase().includes(k))
      );
      if (btInput && btInput.deviceId) {
        idealAudioDeviceId = btInput.deviceId;
        console.log(`[WebRTC] Found connected Bluetooth microphone: ${btInput.label} (${btInput.deviceId})`);
      }
    } catch (e) {
      console.debug('[WebRTC] Audio device enumeration check:', e);
    }
  }

  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    ...(idealAudioDeviceId ? { deviceId: { ideal: idealAudioDeviceId } } : {}),
  };

  // Attempt to acquire real hardware camera and microphone
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    try {
      const videoConstraints: MediaTrackConstraints | boolean =
        callType === 'VIDEO'
          ? {
              facingMode: { ideal: facingMode }, // Front camera ('user') by default
              width: lowDataMode ? { ideal: 640 } : { ideal: 1280, max: 1920 },
              height: lowDataMode ? { ideal: 360 } : { ideal: 720, max: 1080 },
              frameRate: { ideal: 24, max: 30 },
            }
          : false;

      const constraints: MediaStreamConstraints = {
        audio: audioConstraints,
        video: videoConstraints,
      };

      console.log(`[WebRTC] Requesting real user media for ${role} (${callType}, facingMode=${facingMode})...`);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();

      console.log(
        `[WebRTC] Real getUserMedia succeeded for ${role}. Audio tracks: ${audioTracks.length}, Video tracks: ${videoTracks.length}`
      );

      if (audioTracks.length === 0) {
        throw new Error(`Microphone was requested but no audio track was produced for ${role}.`);
      }

      audioTracks.forEach((track) => {
        console.log(
          `[WebRTC-Diagnostics] ${role} Local Audio Track ID: ${track.id}, Label: "${track.label}", Enabled: ${track.enabled}, Muted: ${track.muted}, ReadyState: ${track.readyState}`
        );
      });

      return stream;
    } catch (mediaErr) {
      console.error(`[WebRTC] getUserMedia failed for ${role}:`, mediaErr);

      // If video failed for a video call (e.g. no webcam), try to still get real microphone
      if (callType === 'VIDEO') {
        try {
          console.log(`[WebRTC] Attempting audio-only real microphone acquisition for video call fallback...`);
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
          const audioTracks = audioStream.getAudioTracks();
          if (audioTracks.length > 0) {
            console.log(`[WebRTC] Real microphone acquired for ${role}; no synthetic audio used.`);
            return audioStream;
          }
        } catch (audioErr) {
          console.error(`[WebRTC] Real microphone acquisition also failed for ${role}:`, audioErr);
        }
      }

      throw new Error(
        `Microphone permission denied or microphone hardware unavailable for ${role}: ${(mediaErr as Error)?.message || 'Permission denied'}`
      );
    }
  }

  throw new Error('WebRTC getUserMedia is not supported in this environment.');
}

export class WebRtcCallController {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private unsubscribeCandidates: (() => void) | null = null;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private isRemoteDescriptionSet = false;

  constructor(
    private callId: string,
    private isCaller: boolean,
    private onRemoteStream: (stream: MediaStream) => void,
    private onConnectionState: (state: RTCPeerConnectionState) => void
  ) {}

  /**
   * Initializes the PeerConnection, adds local audio/video tracks, sets ICE listeners
   */
  public async initConnection(localStream: MediaStream): Promise<RTCPeerConnection> {
    this.cleanup();
    this.localStream = localStream;
    this.remoteStream = new MediaStream();

    const roleName = this.isCaller ? 'Caller' : 'Receiver';
    console.log(`[WebRTC-${roleName}] Initializing RTCPeerConnection...`);

    // Diagnostic logging: Permission check
    if (typeof navigator !== 'undefined' && (navigator as any).permissions?.query) {
      try {
        const perm = await (navigator as any).permissions.query({ name: 'microphone' });
        console.log(`[WebRTC-Diagnostics-${roleName}] Microphone permission state: ${perm.state}`);
      } catch {}
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnection = pc;

    // Diagnostic logging: Local tracks
    const tracks = localStream.getTracks();
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      console.log(
        `[WebRTC-Diagnostics-${roleName}] Local Audio Track ID: "${audioTrack.id}", enabled: ${audioTrack.enabled}, muted: ${audioTrack.muted}, readyState: "${audioTrack.readyState}"`
      );
    } else {
      console.error(`[WebRTC-Diagnostics-${roleName}] CRITICAL: No local AudioTrack found in localStream!`);
    }

    tracks.forEach((track) => {
      track.enabled = true;
      pc.addTrack(track, localStream);
    });

    // Diagnostic logging: PeerConnection senders & transceivers
    pc.getSenders().forEach((sender, idx) => {
      console.log(
        `[WebRTC-Diagnostics-${roleName}] Sender #${idx}: kind=${sender.track?.kind}, id=${sender.track?.id}, enabled=${sender.track?.enabled}`
      );
    });
    if (pc.getTransceivers) {
      pc.getTransceivers().forEach((transceiver, idx) => {
        console.log(
          `[WebRTC-Diagnostics-${roleName}] Transceiver #${idx}: mid=${transceiver.mid}, direction=${transceiver.direction}, currentDirection=${transceiver.currentDirection}`
        );
      });
    }

    // Remote track handler
    pc.ontrack = (event) => {
      console.log(
        `[WebRTC-${roleName}] ontrack event received: kind=${event.track.kind}, id=${event.track.id}, enabled=${event.track.enabled}, streams=${event.streams?.length}`
      );

      if (event.track.kind === 'audio') {
        event.track.enabled = true;
        console.log(`[WebRTC-${roleName}] Remote audio track verified & enabled for output.`);
      }

      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        console.log(`[WebRTC-${roleName}] Remote stream has ${event.streams[0].getTracks().length} tracks. Notifying UI...`);
        this.onRemoteStream(new MediaStream(event.streams[0].getTracks()));
      } else if (event.track) {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
        console.log(`[WebRTC-${roleName}] Added track to remoteStream (${this.remoteStream.getTracks().length} total tracks). Notifying UI...`);
        this.onRemoteStream(new MediaStream(this.remoteStream.getTracks()));
      }
    };

    // ICE Gathering state handler
    pc.onicegatheringstatechange = () => {
      console.log(`[WebRTC-ICE-Diagnostics-${roleName}] ICE Gathering State: ${pc.iceGatheringState}`);
    };

    // ICE Connection state handler
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC-ICE-Diagnostics-${roleName}] ICE Connection State: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log(`[WebRTC-ICE-Diagnostics-${roleName}] Media transport connected!`);
        this.onConnectionState('connected');
      }
    };

    // Connection state handler
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC-Diagnostics-${roleName}] PeerConnection State: ${pc.connectionState}`);
      if (pc.connectionState) {
        this.onConnectionState(pc.connectionState);
      }
    };

    // ICE Candidate generation -> Firestore
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC-ICE-Diagnostics-${roleName}] Generated ICE candidate:`, event.candidate.candidate);
        const candidateData = event.candidate.toJSON();
        if (this.isCaller) {
          addCallerCandidate(this.callId, candidateData).catch(console.error);
        } else {
          addReceiverCandidate(this.callId, candidateData).catch(console.error);
        }
      } else {
        console.log(`[WebRTC-ICE-Diagnostics-${roleName}] ICE Candidate gathering complete.`);
      }
    };

    return pc;
  }

  /**
   * Helper to verify that SDP contains m=audio and bidirectional sendrecv
   */
  private verifyAndEnforceAudioSdp(sdp: string, role: string): string {
    const hasAudio = sdp.includes('m=audio');
    const hasSendrecv = sdp.includes('a=sendrecv');
    console.log(
      `[WebRTC-SDP-Verification] [${role}] SDP verification: m=audio present = ${hasAudio}, a=sendrecv present = ${hasSendrecv}`
    );
    if (!hasAudio) {
      console.error(`[WebRTC-SDP-Verification] [${role}] ERROR: SDP is missing m=audio! Audio will not negotiate.`);
    }
    return sdp;
  }

  /**
   * Caller workflow: creates offer, sets local description, saves to Firestore, subscribes to receiver candidates
   */
  public async createAndSendOffer(callType: CallType): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('PeerConnection not initialized');

    console.log(`[WebRTC-Caller] Creating SDP offer for callType: ${callType}...`);
    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: callType === 'VIDEO',
    });

    const validatedSdp = this.verifyAndEnforceAudioSdp(offer.sdp || '', 'Caller-Offer');
    offer.sdp = validatedSdp;

    console.log(`[WebRTC-Caller] Setting LocalDescription (offer)... Contains m=audio: ${offer.sdp?.includes('m=audio')}`);
    await this.peerConnection.setLocalDescription(offer);
    await saveOfferSDP(this.callId, { type: offer.type, sdp: offer.sdp || '' });

    // Listen for receiver candidates
    this.unsubscribeCandidates = subscribeToReceiverCandidates(this.callId, (candidate) => {
      console.log(`[WebRTC-Caller] Received receiver ICE candidate from Firestore:`, candidate);
      this.handleIncomingCandidate(candidate);
    });

    return offer;
  }

  /**
   * Caller workflow: applies the receiver's SDP answer
   */
  public async applyAnswer(answer: { type: string; sdp: string }): Promise<void> {
    if (!this.peerConnection) return;
    if (this.peerConnection.signalingState === 'have-local-offer') {
      this.verifyAndEnforceAudioSdp(answer.sdp, 'Caller-ReceivedAnswer');
      console.log(`[WebRTC-Caller] Applying SDP answer from receiver... Contains m=audio: ${answer.sdp.includes('m=audio')}`);
      const remoteDesc = new RTCSessionDescription({
        type: answer.type as RTCSdpType,
        sdp: answer.sdp,
      });
      await this.peerConnection.setRemoteDescription(remoteDesc);
      this.isRemoteDescriptionSet = true;
      console.log(`[WebRTC-Caller] RemoteDescription (answer) set. Flushing queued ICE candidates...`);
      this.flushCandidateQueue();
    }
  }

  /**
   * Receiver workflow: sets remote offer, creates answer, saves to Firestore, subscribes to caller candidates
   */
  public async handleAndAnswerOffer(
    offer: { type: string; sdp: string },
    callType: CallType,
    connectedAtTimestamp?: number
  ): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('PeerConnection not initialized');

    this.verifyAndEnforceAudioSdp(offer.sdp, 'Receiver-ReceivedOffer');
    console.log(`[WebRTC-Receiver] Setting RemoteDescription (offer)... Contains m=audio: ${offer.sdp.includes('m=audio')}`);
    const remoteDesc = new RTCSessionDescription({
      type: offer.type as RTCSdpType,
      sdp: offer.sdp,
    });
    await this.peerConnection.setRemoteDescription(remoteDesc);
    this.isRemoteDescriptionSet = true;
    this.flushCandidateQueue();

    console.log(`[WebRTC-Receiver] Creating SDP answer...`);
    const answer = await this.peerConnection.createAnswer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: callType === 'VIDEO',
    });

    const validatedAnswerSdp = this.verifyAndEnforceAudioSdp(answer.sdp || '', 'Receiver-Answer');
    answer.sdp = validatedAnswerSdp;

    console.log(`[WebRTC-Receiver] Setting LocalDescription (answer)... Contains m=audio: ${answer.sdp?.includes('m=audio')}`);
    await this.peerConnection.setLocalDescription(answer);
    await saveAnswerSDP(this.callId, { type: answer.type, sdp: answer.sdp || '' }, connectedAtTimestamp);

    // Listen for caller candidates
    this.unsubscribeCandidates = subscribeToCallerCandidates(this.callId, (candidate) => {
      console.log(`[WebRTC-Receiver] Received caller ICE candidate from Firestore:`, candidate);
      this.handleIncomingCandidate(candidate);
    });

    return answer;
  }

  private handleIncomingCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection) return;

    if (this.isRemoteDescriptionSet && this.peerConnection.remoteDescription) {
      this.peerConnection
        .addIceCandidate(new RTCIceCandidate(candidate))
        .then(() => console.log(`[WebRTC-${this.isCaller ? 'Caller' : 'Receiver'}] ICE candidate added successfully.`))
        .catch((err) => console.warn(`[WebRTC-${this.isCaller ? 'Caller' : 'Receiver'}] Add ICE candidate notice:`, err));
    } else {
      console.log(`[WebRTC-${this.isCaller ? 'Caller' : 'Receiver'}] Queuing ICE candidate (remoteDescription pending)...`);
      this.candidateQueue.push(candidate);
    }
  }

  private flushCandidateQueue() {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    console.log(`[WebRTC-${this.isCaller ? 'Caller' : 'Receiver'}] Flushing ${this.candidateQueue.length} queued ICE candidate(s)...`);
    while (this.candidateQueue.length > 0) {
      const cand = this.candidateQueue.shift();
      if (cand) {
        this.peerConnection
          .addIceCandidate(new RTCIceCandidate(cand))
          .catch((err) => console.warn(`[WebRTC-${this.isCaller ? 'Caller' : 'Receiver'}] Flush ICE candidate notice:`, err));
      }
    }
  }

  /**
   * Toggle track mute status
   */
  public toggleMute(muted: boolean) {
    console.log(`[WebRTC-${this.isCaller ? 'Caller' : 'Receiver'}] Setting mic mute = ${muted}`);
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  /**
   * Toggle camera status
   */
  public toggleCamera(cameraOff: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = !cameraOff;
      });
    }
  }

  /**
   * Switch between front ('user') and rear ('environment') camera on active video call
   */
  public async switchCamera(facingMode: 'user' | 'environment'): Promise<MediaStreamTrack | null> {
    const roleName = this.isCaller ? 'Caller' : 'Receiver';
    console.log(`[WebRTC-${roleName}] Switching camera to facingMode: ${facingMode}...`);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return null;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 24, max: 30 },
        },
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return null;

      // Replace track on RTCPeerConnection sender
      if (this.peerConnection) {
        const senders = this.peerConnection.getSenders();
        const videoSender = senders.find((s) => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
          console.log(`[WebRTC-${roleName}] RTCRtpSender.replaceTrack succeeded with new camera track.`);
        }
      }

      // Replace video track in localStream
      if (this.localStream) {
        const currentVideoTracks = this.localStream.getVideoTracks();
        currentVideoTracks.forEach((track) => {
          track.stop();
          this.localStream?.removeTrack(track);
        });
        this.localStream.addTrack(newVideoTrack);
      }

      return newVideoTrack;
    } catch (err) {
      console.warn(`[WebRTC-${roleName}] switchCamera notice:`, err);
      return null;
    }
  }

  /**
   * Dynamically add video track when upgrading an audio call to a video call
   */
  public async addVideoTrack(videoTrack: MediaStreamTrack) {
    const roleName = this.isCaller ? 'Caller' : 'Receiver';
    console.log(`[WebRTC-${roleName}] Adding video track for call upgrade...`);

    if (this.localStream) {
      this.localStream.addTrack(videoTrack);
    }

    if (this.peerConnection) {
      // Check if video sender already exists
      const senders = this.peerConnection.getSenders();
      const videoSender = senders.find((s) => s.track === null || s.track?.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(videoTrack);
      } else if (this.localStream) {
        this.peerConnection.addTrack(videoTrack, this.localStream);
      }
    }
  }

  /**
   * Remove and stop video tracks when switching from video to audio call
   */
  public removeVideoTracks() {
    const roleName = this.isCaller ? 'Caller' : 'Receiver';
    console.log(`[WebRTC-${roleName}] Removing video tracks for downgrade to audio...`);

    if (this.peerConnection) {
      const senders = this.peerConnection.getSenders();
      const videoSender = senders.find((s) => s.track?.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(null).catch(console.error);
      }
    }

    if (this.localStream) {
      const videoTracks = this.localStream.getVideoTracks();
      videoTracks.forEach((t) => {
        t.stop();
        this.localStream?.removeTrack(t);
      });
    }
  }

  /**
   * Full cleanup of PeerConnection, streams, and candidate listeners
   */
  public cleanup() {
    console.log(`[WebRTC-${this.isCaller ? 'Caller' : 'Receiver'}] Cleaning up connection...`);
    if (this.unsubscribeCandidates) {
      this.unsubscribeCandidates();
      this.unsubscribeCandidates = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.ontrack = null;
        this.peerConnection.onicecandidate = null;
        this.peerConnection.oniceconnectionstatechange = null;
        this.peerConnection.onconnectionstatechange = null;
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
    this.candidateQueue = [];
    this.isRemoteDescriptionSet = false;
  }
}

