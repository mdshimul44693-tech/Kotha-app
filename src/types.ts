export type Language = 'en' | 'bn';

export type CallType = 'AUDIO' | 'VIDEO';

export type CallState =
  | 'IDLE'
  | 'CALLING'
  | 'RINGING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ENDED'
  | 'REJECTED'
  | 'FAILED';

export type MessageType = 'TEXT' | 'VOICE' | 'IMAGE';

export type MessageStatus = 'SENDING' | 'SENT' | 'DELIVERED' | 'READ';

export interface UserProfile {
  userId: string;
  phoneNumber: string;
  fullName: string;
  profilePhotoUrl: string;
  about: string;
  isOnline: boolean;
  lastSeen: number;
  fcmToken: string;
  lowDataMode: boolean;
  preferredLanguage: Language;
}

export interface ChatMessage {
  messageId: string;
  senderId: string;
  receiverId: string;
  text?: string;
  type: MessageType;
  mediaUrl?: string;
  mediaDurationMs?: number;
  timestamp: number;
  status: MessageStatus;
}

export interface DirectChat {
  chatId: string;
  participantIds: string[];
  lastMessage?: ChatMessage;
  unreadCount: number;
  updatedAt: number;
}

export interface CallRecord {
  callId: string;
  peerId: string;
  peerName: string;
  peerPhotoUrl: string;
  peerPhone: string;
  callType: CallType;
  direction: 'INCOMING' | 'OUTGOING';
  status: 'ANSWERED' | 'MISSED' | 'REJECTED' | 'CANCELLED' | 'FAILED';
  timestamp: number;
  durationSeconds: number;
}

export interface DeviceContact {
  id: string;
  displayName: string;
  phoneNumber: string;
  isKothaUser: boolean;
  kothaUserId?: string;
  kothaProfilePhoto?: string;
  about?: string;
}

export interface WebRtcCallSession {
  callId: string;
  callerId: string;
  callerName: string;
  callerPhoto: string;
  receiverId: string;
  receiverName: string;
  receiverPhoto: string;
  callType: CallType;
  callState: CallState;
  startedAt: number;
  connectedAt?: number;
  endedAt?: number;
  isMuted: boolean;
  isCameraOff: boolean;
  isSpeakerOn: boolean;
  isFrontCamera: boolean;
  lowDataMode: boolean;
  audioRoute?: AudioOutputRoute;
  callerCameraOff?: boolean;
  receiverCameraOff?: boolean;
  callerFrontCamera?: boolean;
  receiverFrontCamera?: boolean;
  callerMuted?: boolean;
  receiverMuted?: boolean;
  offer?: {
    type: string;
    sdp: string;
  };
  answer?: {
    type: string;
    sdp: string;
  };
}

export type AudioOutputRoute = 'EARPIECE' | 'SPEAKER' | 'BLUETOOTH';

export type BluetoothDeviceType = 'TYPE_BLE_HEADSET' | 'TYPE_BLUETOOTH_SCO' | 'TYPE_BLUETOOTH_A2DP';

export interface SimulatedBluetoothDevice {
  id: string;
  name: string;
  type: BluetoothDeviceType;
  isConnected: boolean;
  batteryLevel?: number;
}

export interface AudioRoutingTelemetry {
  availableDevices: string[];
  selectedDevice: string;
  currentAudioMode: 'MODE_IN_COMMUNICATION' | 'MODE_NORMAL';
  bluetoothConnectionState: 'STATE_CONNECTED' | 'STATE_DISCONNECTED';
  bluetoothDeviceName?: string;
  audioFocusState: 'AUDIOFOCUS_GAIN_TRANSIENT' | 'AUDIOFOCUS_NONE' | 'AUDIOFOCUS_LOSS';
  remoteAudioPlaybackState: 'PLAYING' | 'PAUSED' | 'IDLE' | 'ROUTING_TO_BLUETOOTH' | 'ROUTING_TO_EARPIECE' | 'ROUTING_TO_SPEAKER';
  sampleRate: number;
  activeRoute: AudioOutputRoute;
  isRealBluetoothDetected: boolean;
  lastUpdated: number;
}
