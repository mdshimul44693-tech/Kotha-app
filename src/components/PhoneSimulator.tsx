import React, { useState, useRef, useEffect } from 'react';
import {
  UserProfile,
  ChatMessage,
  DeviceContact,
  CallRecord,
  WebRtcCallSession,
  CallType,
  Language,
  AudioOutputRoute,
} from '../types';
import { translations } from '../data/translations';
import { attachAndPlayRemoteAudio, getDeviceAudioRouteManager } from '../lib/audioPipeline';
import { AudioRoutingControl } from './AudioRoutingControl';
import {
  MessageSquare,
  Users,
  Phone,
  Settings,
  Mic,
  Send,
  Camera,
  Video,
  VideoOff,
  MicOff,
  Volume2,
  VolumeX,
  PhoneOff,
  Check,
  CheckCheck,
  Play,
  Pause,
  RefreshCw,
  Search,
  ArrowLeft,
  Globe,
  Database,
  User as UserIcon,
  ShieldCheck,
  Clock,
  Sparkles,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Headphones,
  Bluetooth,
  Activity,
} from 'lucide-react';

interface PhoneSimulatorProps {
  currentUser: UserProfile;
  peerUser: UserProfile;
  contacts: DeviceContact[];
  messages: ChatMessage[];
  callHistory: CallRecord[];
  activeCall: WebRtcCallSession | null;
  onSendMessage: (text: string, type?: 'TEXT' | 'VOICE', mediaUrl?: string, duration?: number) => void;
  onInitiateCall: (type: 'AUDIO' | 'VIDEO') => void;
  onAnswerCall: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleSpeaker: () => void;
  onSwitchCamera: () => void;
  onSwitchCallType?: (newType: CallType) => void;
  onUpdateProfile: (name: string, about: string) => void;
  onToggleLowDataMode: () => void;
  onChangeLanguage: (lang: Language) => void;
  onSyncContacts: () => void;
  isCallInitiator: boolean;
  localMediaStream: MediaStream | null;
  remoteMediaStream: MediaStream | null;
  onLoadOlderMessages?: () => void;
  hasMoreOlderMessages?: boolean;
  isLoadingOlderMessages?: boolean;
}

export const PhoneSimulator: React.FC<PhoneSimulatorProps> = ({
  currentUser,
  peerUser,
  contacts,
  messages,
  callHistory,
  activeCall,
  onSendMessage,
  onInitiateCall,
  onAnswerCall,
  onEndCall,
  onToggleMute,
  onToggleCamera,
  onToggleSpeaker,
  onSwitchCamera,
  onSwitchCallType,
  onUpdateProfile,
  onToggleLowDataMode,
  onChangeLanguage,
  onSyncContacts,
  isCallInitiator,
  localMediaStream,
  remoteMediaStream,
  onLoadOlderMessages,
  hasMoreOlderMessages = false,
  isLoadingOlderMessages = false,
}) => {
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts' | 'calls' | 'settings'>('chats');
  const [currentScreen, setCurrentScreen] = useState<'list' | 'chat_detail'>('list');
  const [inputText, setInputText] = useState('');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceRecordDuration, setVoiceRecordDuration] = useState(0);
  const [elapsedCallSeconds, setElapsedCallSeconds] = useState(0);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [editName, setEditName] = useState(currentUser.fullName);
  const [editAbout, setEditAbout] = useState(currentUser.about);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasContactsPermission, setHasContactsPermission] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = useRef<number>(messages.length);
  const prevScrollHeightRef = useRef<number>(0);

  const t = translations[currentUser.preferredLanguage || 'bn'];

  // Scroll chat messages management with pagination awareness
  useEffect(() => {
    if (currentScreen === 'chat_detail') {
      const container = messagesContainerRef.current;
      if (container) {
        // If older messages were prepended at top
        if (messages.length > prevMessagesLengthRef.current && prevScrollHeightRef.current > 0) {
          const newScrollHeight = container.scrollHeight;
          const diff = newScrollHeight - prevScrollHeightRef.current;
          container.scrollTop = diff;
        } else if (messages.length !== prevMessagesLengthRef.current) {
          // New message appended at bottom
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }
      prevMessagesLengthRef.current = messages.length;
    }
  }, [messages, currentScreen]);

  // Initial scroll to bottom when entering chat detail
  useEffect(() => {
    if (currentScreen === 'chat_detail') {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 50);
    }
  }, [currentScreen]);

  // Handle scroll to top for pagination
  const handleScrollMessages = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    prevScrollHeightRef.current = container.scrollHeight;
    if (container.scrollTop <= 20 && hasMoreOlderMessages && !isLoadingOlderMessages && onLoadOlderMessages) {
      onLoadOlderMessages();
    }
  };

  const isMeCaller = activeCall ? activeCall.callerId === currentUser.userId : false;
  const isMyCameraOff = activeCall
    ? (isMeCaller ? (activeCall.callerCameraOff ?? activeCall.isCameraOff) : (activeCall.receiverCameraOff ?? activeCall.isCameraOff))
    : false;
  const isPeerCameraOff = activeCall
    ? (isMeCaller ? (activeCall.receiverCameraOff ?? false) : (activeCall.callerCameraOff ?? false))
    : false;
  const isMyFrontCamera = activeCall
    ? (isMeCaller ? (activeCall.callerFrontCamera ?? activeCall.isFrontCamera ?? true) : (activeCall.receiverFrontCamera ?? true))
    : true;
  const isMyMuted = activeCall
    ? (isMeCaller ? (activeCall.callerMuted ?? activeCall.isMuted) : (activeCall.receiverMuted ?? activeCall.isMuted))
    : false;

  // Bind local camera preview stream
  useEffect(() => {
    if (localVideoRef.current && localMediaStream) {
      localVideoRef.current.srcObject = localMediaStream;
      localVideoRef.current.muted = true;
      localVideoRef.current.defaultMuted = true;
      localVideoRef.current.play().catch((e) => console.debug('local video play notice:', e));
    }
  }, [localMediaStream, isMyCameraOff, isMyFrontCamera]);

  // Bind remote video and audio streams
  useEffect(() => {
    if (remoteVideoRef.current && remoteMediaStream) {
      remoteVideoRef.current.srcObject = remoteMediaStream;
      remoteVideoRef.current.play().catch((e) => console.debug('remote video play notice:', e));
    }
    if (remoteAudioRef.current && remoteMediaStream) {
      attachAndPlayRemoteAudio(
        remoteAudioRef.current,
        remoteMediaStream,
        `Device-${currentUser.userId}`
      ).catch((err) => console.warn('attachAndPlayRemoteAudio notice:', err));
    }
  }, [remoteMediaStream, activeCall?.callState, currentUser.userId, isPeerCameraOff]);

  // Manage Android Audio Routing Session & Audio Focus during call
  useEffect(() => {
    const manager = getDeviceAudioRouteManager(currentUser.userId);
    if (
      activeCall &&
      (activeCall.callState === 'RINGING' ||
        activeCall.callState === 'CONNECTING' ||
        activeCall.callState === 'CONNECTED')
    ) {
      manager.startCallAudioSession();
    } else {
      manager.endCallAudioSession();
    }
  }, [activeCall?.callState, currentUser.userId]);

  // Voice recording handler
  const startVoiceRecording = async () => {
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        onSendMessage('', 'VOICE', audioUrl, voiceRecordDuration * 1000 || 3500);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecordingVoice(true);
      setVoiceRecordDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setVoiceRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn('Microphone permission denied for voice message recording:', err);
      setIsRecordingVoice(false);
      setVoiceRecordDuration(0);
    }
  };

  const stopVoiceRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingVoice(false);
  };

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim(), 'TEXT');
    setInputText('');
  };

  const handleSyncContactsClick = () => {
    setIsSyncing(true);
    setTimeout(() => {
      onSyncContacts();
      setIsSyncing(false);
    }, 800);
  };

  // Synchronized call duration timer based on authoritative connectedAt
  useEffect(() => {
    if (activeCall?.callState !== 'CONNECTED' || !activeCall.connectedAt) {
      setElapsedCallSeconds(0);
      return;
    }

    const connectedAt = activeCall.connectedAt;

    // Immediately calculate initial elapsed time from authoritative timestamp
    const updateElapsed = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((now - connectedAt) / 1000));
      setElapsedCallSeconds(diff);
    };

    updateElapsed();

    const intervalId = setInterval(updateElapsed, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeCall?.callState, activeCall?.connectedAt]);

  // Format call duration based on authoritative synchronized seconds
  const getCallDurationString = () => {
    const mins = Math.floor(elapsedCallSeconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (elapsedCallSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="relative w-full max-w-[390px] h-[760px] bg-slate-900 rounded-[44px] p-3 shadow-2xl border-4 border-slate-700 flex flex-col select-none overflow-hidden">
      {/* Phone Hardware Notch & Status Bar */}
      <div className="w-full pt-1 pb-2 px-6 flex items-center justify-between text-xs text-slate-300 font-medium z-30">
        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <div className="w-24 h-4 bg-black rounded-full mx-auto" />
        <div className="flex items-center gap-1.5">
          {currentUser.lowDataMode && (
            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1 rounded font-mono">
              360p
            </span>
          )}
          <span>5G</span>
          <div className="w-4 h-2.5 border border-slate-300 rounded-sm p-0.5 flex items-center">
            <div className="w-full h-full bg-emerald-400 rounded-2xs" />
          </div>
        </div>
      </div>

      {/* Screen Frame */}
      <div className="relative flex-1 bg-slate-950 rounded-[34px] overflow-hidden flex flex-col border border-slate-800/80">
        <audio
          ref={remoteAudioRef}
          autoPlay
          playsInline
          className="absolute w-1 h-1 opacity-0 pointer-events-none"
        />
        {/* ============================================================ */}
        {/* ACTIVE CALL OVERLAY (Incoming / Outgoing / Connected) */}
        {/* ============================================================ */}
        {activeCall && activeCall.callState !== 'IDLE' && activeCall.callState !== 'ENDED' && (
          <div className="absolute inset-0 z-50 bg-slate-950 flex flex-col justify-between p-5 overflow-hidden">
            {/* INCOMING CALL SCREEN */}
            {activeCall.callState === 'RINGING' && !isCallInitiator ? (
              <div className="flex-1 flex flex-col justify-between py-3">
                {/* Android Telecom Heads-up Notification Card */}
                <div className="w-full bg-slate-900/95 border border-emerald-500/40 rounded-2xl p-3 shadow-2xl backdrop-blur-md animate-slide-down">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-slate-950">
                        <PhoneIncoming className="w-3 h-3" />
                      </div>
                      <span className="text-[11px] font-semibold text-emerald-400">
                        {t.telecomIncomingTitle}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">FCM Push • WebRTC</span>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={activeCall.callerPhoto}
                        alt={activeCall.callerName}
                        className="w-10 h-10 rounded-full object-cover border border-emerald-400/60"
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">
                          {activeCall.callerName}
                        </p>
                        <p className="text-[10px] text-slate-300 truncate">
                          {activeCall.callType === 'VIDEO' ? t.incomingVideoCall : t.incomingAudioCall}
                        </p>
                      </div>
                    </div>

                    {/* Notification Action Chips */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={onEndCall}
                        className="px-2.5 py-1.5 bg-rose-600/90 hover:bg-rose-500 text-white rounded-lg text-[10px] font-semibold flex items-center gap-1 transition"
                      >
                        <PhoneOff className="w-3 h-3" />
                        <span>{t.decline}</span>
                      </button>
                      <button
                        onClick={onAnswerCall}
                        className="px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-[10px] font-bold flex items-center gap-1 shadow-lg shadow-emerald-500/30 transition animate-pulse"
                      >
                        {activeCall.callType === 'VIDEO' ? (
                          <Video className="w-3 h-3" />
                        ) : (
                          <Phone className="w-3 h-3" />
                        )}
                        <span>{t.accept}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Central Calling Identity & Pulsing Waves */}
                <div className="flex-1 flex flex-col items-center justify-center my-4 space-y-4 text-center">
                  <div className="relative flex items-center justify-center">
                    {/* Animated Pulsing Sound Waves / Rings */}
                    <div className="absolute w-36 h-36 rounded-full bg-emerald-500/15 animate-ping duration-1000" />
                    <div className="absolute w-48 h-48 rounded-full bg-emerald-500/10 animate-pulse" />
                    <div className="relative w-28 h-28 rounded-full overflow-hidden border-3 border-emerald-400 shadow-2xl shadow-emerald-500/40">
                      <img
                        src={activeCall.callerPhoto}
                        alt={activeCall.callerName}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-white tracking-wide">
                      {activeCall.callerName}
                    </h3>
                    <div className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium bg-emerald-950/60 border border-emerald-800/80 px-3 py-1 rounded-full">
                      <Volume2 className="w-3.5 h-3.5 animate-bounce text-emerald-400" />
                      <span>{t.ringingThroughSpeaker}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>End-to-End Encrypted Telecom Session</span>
                  </div>
                </div>

                {/* Bottom Main Call Action Buttons */}
                <div className="w-full flex items-center justify-around px-4 pb-2">
                  <button
                    onClick={onEndCall}
                    className="flex flex-col items-center gap-2 group cursor-pointer"
                    id="btn-decline-call"
                  >
                    <div className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center text-white shadow-xl shadow-rose-600/40 transition-transform active:scale-95">
                      <PhoneOff className="w-7 h-7" />
                    </div>
                    <span className="text-xs font-semibold text-rose-300">{t.decline}</span>
                  </button>

                  <button
                    onClick={onAnswerCall}
                    className="flex flex-col items-center gap-2 group cursor-pointer animate-bounce"
                    id="btn-accept-call"
                  >
                    <div className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center text-slate-950 shadow-xl shadow-emerald-500/40 transition-transform active:scale-95">
                      {activeCall.callType === 'VIDEO' ? (
                        <Video className="w-7 h-7" />
                      ) : (
                        <Phone className="w-7 h-7 fill-current" />
                      )}
                    </div>
                    <span className="text-xs font-bold text-emerald-300">{t.accept}</span>
                  </button>
                </div>
              </div>
            ) : (
              /* OUTGOING OR ACTIVE CONNECTED CALL */
              <div className="flex-1 flex flex-col justify-between">
                {/* Top Info Bar */}
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-white">
                      {isCallInitiator ? activeCall.receiverName : activeCall.callerName}
                    </h4>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-emerald-400 font-mono">
                        {activeCall.callState === 'CONNECTED'
                          ? getCallDurationString()
                          : activeCall.callState === 'CALLING'
                          ? t.calling
                          : activeCall.callState === 'RINGING'
                          ? t.ringing
                          : t.connecting}
                      </p>
                      <span className="text-[10px] text-slate-400 font-medium">
                        • {activeCall.callType === 'VIDEO' ? 'Video Call' : 'Voice Call'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {activeCall.lowDataMode && (
                      <span className="text-[10px] bg-slate-800 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
                        Low Data (360p)
                      </span>
                    )}

                    {onSwitchCallType && (
                      <button
                        onClick={() => onSwitchCallType(activeCall.callType === 'VIDEO' ? 'AUDIO' : 'VIDEO')}
                        className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition flex items-center gap-1 ${
                          activeCall.callType === 'VIDEO'
                            ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                            : 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-600/30'
                        }`}
                        title={activeCall.callType === 'VIDEO' ? 'Switch to Audio Call' : 'Switch to Video Call'}
                      >
                        {activeCall.callType === 'VIDEO' ? (
                          <>
                            <Phone className="w-3 h-3" />
                            <span>Audio</span>
                          </>
                        ) : (
                          <>
                            <Video className="w-3 h-3" />
                            <span>Video</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Video Stage or Audio Waveform Avatar */}
                <div className="relative flex-1 my-4 bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800">
                  {activeCall.callType === 'VIDEO' ? (
                    <>
                      {/* Remote Video Stream */}
                      <video
                        ref={remoteVideoRef}
                        autoPlay
                        playsInline
                        className={`w-full h-full object-cover ${isPeerCameraOff ? 'hidden' : 'block'}`}
                      />

                      {/* Peer Camera Turned Off Overlay */}
                      {isPeerCameraOff ? (
                        <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center text-center p-4">
                          <img
                            src={
                              isCallInitiator
                                ? activeCall.receiverPhoto
                                : activeCall.callerPhoto
                            }
                            alt="Peer"
                            className="w-20 h-20 rounded-full object-cover border-2 border-slate-700 mb-3"
                            referrerPolicy="no-referrer"
                          />
                          <p className="text-sm font-semibold text-white">
                            {isCallInitiator ? activeCall.receiverName : activeCall.callerName}
                          </p>
                          <span className="text-xs text-rose-400 flex items-center gap-1.5 mt-2 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-full">
                            <VideoOff className="w-3.5 h-3.5" /> Camera is turned off
                          </span>
                        </div>
                      ) : (!remoteMediaStream || activeCall.callState !== 'CONNECTED') && (
                        <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-center p-4">
                          <img
                            src={
                              isCallInitiator
                                ? activeCall.receiverPhoto
                                : activeCall.callerPhoto
                            }
                            alt="Peer"
                            className="w-20 h-20 rounded-full object-cover border-2 border-slate-700 mb-3 animate-pulse"
                            referrerPolicy="no-referrer"
                          />
                          <p className="text-xs text-slate-300">
                            {activeCall.callState === 'CONNECTED'
                              ? 'Waiting for video stream...'
                              : t.connecting}
                          </p>
                        </div>
                      )}

                      {/* Local Video Picture-in-Picture (PiP) */}
                      {isMyCameraOff ? (
                        <div className="absolute bottom-3 right-3 w-24 h-36 bg-slate-900/95 rounded-xl overflow-hidden border-2 border-slate-700 shadow-2xl flex flex-col items-center justify-center text-center p-2 z-10">
                          <VideoOff className="w-6 h-6 text-slate-400 mb-1" />
                          <span className="text-[9px] font-medium text-slate-400">Camera Off</span>
                        </div>
                      ) : (
                        <div className="absolute bottom-3 right-3 w-24 h-36 bg-black rounded-xl overflow-hidden border-2 border-slate-700 shadow-2xl z-10 group">
                          <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className={`w-full h-full object-cover transition-transform ${
                              isMyFrontCamera ? '-scale-x-100' : 'scale-x-100'
                            }`}
                          />
                          <div className="absolute top-1.5 left-1.5 bg-black/60 backdrop-blur-xs text-[8px] font-semibold text-slate-300 px-1.5 py-0.5 rounded">
                            {isMyFrontCamera ? 'Front' : 'Rear'}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    /* AUDIO CALL UI */
                    <div className="flex flex-col items-center justify-center text-center space-y-4">
                      <div className="relative">
                        <div className="absolute -inset-4 bg-emerald-500/20 rounded-full blur-md animate-pulse" />
                        <img
                          src={
                            isCallInitiator
                              ? activeCall.receiverPhoto
                              : activeCall.callerPhoto
                          }
                          alt="User"
                          className="relative w-28 h-28 rounded-full object-cover border-2 border-emerald-500/50 shadow-2xl"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white">
                          {isCallInitiator ? activeCall.receiverName : activeCall.callerName}
                        </h3>
                        <p className="text-xs text-slate-400">Encrypted P2P Voice Call</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Hidden Remote Audio Element for WebRTC VoIP track attachment */}
                <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

                {/* Android Communication Device Routing & Bluetooth Manager */}
                <div className="px-1 py-1">
                  <AudioRoutingControl
                    userId={currentUser.userId}
                    language={currentUser.preferredLanguage}
                    isInCall={true}
                    onRouteChanged={(route) => {
                      if (route === 'SPEAKER' && !activeCall.isSpeakerOn) {
                        onToggleSpeaker();
                      } else if (route !== 'SPEAKER' && activeCall.isSpeakerOn) {
                        onToggleSpeaker();
                      }
                    }}
                  />
                </div>

                {/* In-Call Controls Bar */}
                <div className="grid grid-cols-4 gap-2 pt-2">
                  <button
                    onClick={onToggleMute}
                    className={`p-3 rounded-full flex flex-col items-center justify-center gap-1 transition ${
                      isMyMuted
                        ? 'bg-rose-500 text-white'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    }`}
                    title={isMyMuted ? t.unmute : t.mute}
                  >
                    {isMyMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    <span className="text-[9px]">{isMyMuted ? t.unmute : t.mute}</span>
                  </button>

                  {activeCall.callType === 'VIDEO' ? (
                    <button
                      onClick={onToggleCamera}
                      className={`p-3 rounded-full flex flex-col items-center justify-center gap-1 transition ${
                        isMyCameraOff
                          ? 'bg-rose-500 text-white'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                      title={isMyCameraOff ? t.turnCameraOn : t.turnCameraOff}
                    >
                      {isMyCameraOff ? (
                        <VideoOff className="w-5 h-5" />
                      ) : (
                        <Video className="w-5 h-5" />
                      )}
                      <span className="text-[9px]">Camera</span>
                    </button>
                  ) : (
                    <button
                      onClick={onToggleSpeaker}
                      className={`p-3 rounded-full flex flex-col items-center justify-center gap-1 transition ${
                        activeCall.isSpeakerOn
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                      title={t.speaker}
                    >
                      {activeCall.isSpeakerOn ? (
                        <Volume2 className="w-5 h-5" />
                      ) : (
                        <VolumeX className="w-5 h-5" />
                      )}
                      <span className="text-[9px]">{t.speaker}</span>
                    </button>
                  )}

                  {activeCall.callType === 'VIDEO' ? (
                    <button
                      onClick={onSwitchCamera}
                      className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-full flex flex-col items-center justify-center gap-1 transition"
                      title={t.switchCamera}
                    >
                      <RefreshCw className="w-5 h-5" />
                      <span className="text-[9px]">Flip</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => onSwitchCallType && onSwitchCallType('VIDEO')}
                      className="p-3 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-full flex flex-col items-center justify-center gap-1 transition"
                      title="Switch to Video Call"
                    >
                      <Video className="w-5 h-5" />
                      <span className="text-[9px]">To Video</span>
                    </button>
                  )}

                  <button
                    onClick={onEndCall}
                    className="p-3 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex flex-col items-center justify-center gap-1 transition shadow-lg shadow-rose-600/30"
                    title={t.endCall}
                    id="btn-end-call"
                  >
                    <PhoneOff className="w-5 h-5" />
                    <span className="text-[9px]">{t.endCall}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* SCREEN 1: CHAT DETAIL VIEW */}
        {/* ============================================================ */}
        {currentScreen === 'chat_detail' ? (
          <div className="flex-1 flex flex-col h-full bg-slate-950">
            {/* Header */}
            <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setCurrentScreen('list')}
                  className="p-1 text-slate-400 hover:text-white rounded-full transition"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="relative">
                  <img
                    src={peerUser.profilePhotoUrl}
                    alt={peerUser.fullName}
                    className="w-9 h-9 rounded-full object-cover border border-slate-700"
                    referrerPolicy="no-referrer"
                  />
                  {peerUser.isOnline && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-slate-900" />
                  )}
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white leading-tight">
                    {peerUser.fullName}
                  </h4>
                  <p className="text-[10px] text-emerald-400">
                    {peerUser.isOnline ? t.online : t.offline}
                  </p>
                </div>
              </div>

              {/* Call Initiation Buttons */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onInitiateCall('AUDIO')}
                  className="p-2 text-slate-300 hover:text-emerald-400 hover:bg-slate-800 rounded-full transition"
                  title={t.audioCall}
                  id="btn-call-audio"
                >
                  <Phone className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onInitiateCall('VIDEO')}
                  className="p-2 text-slate-300 hover:text-emerald-400 hover:bg-slate-800 rounded-full transition"
                  title={t.videoCall}
                  id="btn-call-video"
                >
                  <Video className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages Stream */}
            <div
              ref={messagesContainerRef}
              onScroll={handleScrollMessages}
              className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-950/60"
            >
              {/* Pagination Top Banner / Trigger */}
              {isLoadingOlderMessages ? (
                <div className="flex items-center justify-center py-2 text-slate-400 gap-2 text-[11px]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  <span>{t.loadingOlderMessages}</span>
                </div>
              ) : hasMoreOlderMessages ? (
                <div className="flex justify-center py-1">
                  <button
                    onClick={onLoadOlderMessages}
                    className="px-2.5 py-1 text-[10px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-full border border-slate-700/80 transition flex items-center gap-1 shadow-sm"
                  >
                    <Clock className="w-3 h-3 text-emerald-400" />
                    <span>{t.loadOlderMessages}</span>
                  </button>
                </div>
              ) : (
                <div className="text-center py-1 text-[9px] text-slate-600 uppercase tracking-wider font-semibold">
                  {t.noMoreMessages}
                </div>
              )}

              {messages.map((msg) => {
                const isMe = msg.senderId === currentUser.userId;
                return (
                  <div
                    key={msg.messageId}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[82%] px-3 py-2 rounded-2xl text-xs break-words shadow-sm ${
                        isMe
                          ? 'bg-emerald-600 text-white rounded-br-xs'
                          : 'bg-slate-800 text-slate-100 rounded-bl-xs border border-slate-700/60'
                      }`}
                    >
                      {msg.type === 'VOICE' ? (
                        <div className="flex items-center gap-2 py-0.5 min-w-[170px]">
                          <button
                            onClick={() => {
                              if (playingMessageId === msg.messageId) {
                                setPlayingMessageId(null);
                              } else {
                                setPlayingMessageId(msg.messageId);
                                setTimeout(() => setPlayingMessageId(null), 3000);
                              }
                            }}
                            className="w-7 h-7 rounded-full bg-black/30 hover:bg-black/40 flex items-center justify-center text-white shrink-0"
                          >
                            {playingMessageId === msg.messageId ? (
                              <Pause className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5 ml-0.5" />
                            )}
                          </button>
                          <div className="flex-1 space-y-1">
                            <div className="h-1.5 bg-black/20 rounded-full overflow-hidden">
                              <div
                                className={`h-full bg-white rounded-full transition-all duration-300 ${
                                  playingMessageId === msg.messageId ? 'w-full' : 'w-0'
                                }`}
                              />
                            </div>
                            <div className="flex justify-between text-[9px] opacity-80">
                              <span>{t.voiceMessage}</span>
                              <span>
                                {Math.round((msg.mediaDurationMs || 3000) / 1000)}s
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 mt-0.5 px-1 text-[9px] text-slate-400">
                      <span>{formatTime(msg.timestamp)}</span>
                      {isMe && (
                        <span>
                          {msg.status === 'READ' ? (
                            <CheckCheck className="w-3 h-3 text-cyan-400" />
                          ) : msg.status === 'DELIVERED' ? (
                            <CheckCheck className="w-3 h-3 text-slate-400" />
                          ) : (
                            <Check className="w-3 h-3 text-slate-400" />
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-2.5 bg-slate-900 border-t border-slate-800">
              {isRecordingVoice ? (
                <div className="flex items-center justify-between bg-rose-950/40 border border-rose-500/30 rounded-2xl px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-ping" />
                    <span className="text-xs text-rose-300 font-medium">
                      {t.recordingVoice} ({voiceRecordDuration}s)
                    </span>
                  </div>
                  <button
                    onClick={stopVoiceRecording}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow cursor-pointer"
                  >
                    {t.send}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder={t.typeMessage}
                    className="flex-1 bg-slate-800 text-white placeholder-slate-400 text-xs px-3.5 py-2.5 rounded-2xl outline-none focus:ring-1 focus:ring-emerald-500 border border-slate-700/60"
                  />

                  {inputText.trim() ? (
                    <button
                      onClick={handleSend}
                      className="p-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full transition shadow active:scale-95 cursor-pointer"
                      id="btn-send-message"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={startVoiceRecording}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-full transition border border-slate-700 cursor-pointer"
                      title={t.holdToRecord}
                      id="btn-record-voice"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ============================================================ */
          /* SCREEN 2: MAIN TABS (Chats / Contacts / Calls / Settings) */
          /* ============================================================ */
          <div className="flex-1 flex flex-col h-full bg-slate-950">
            {/* Top App Header */}
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-1.5">
                  <span className="text-emerald-400">কথা</span>
                  <span>{t.appName}</span>
                </h2>
                <p className="text-[10px] text-slate-400">{currentUser.fullName}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    onChangeLanguage(currentUser.preferredLanguage === 'bn' ? 'en' : 'bn')
                  }
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-medium rounded-lg border border-slate-700 flex items-center gap-1"
                >
                  <Globe className="w-3 h-3 text-emerald-400" />
                  <span>{currentUser.preferredLanguage === 'bn' ? 'EN' : 'বাং'}</span>
                </button>
              </div>
            </div>

            {/* Quick Bluetooth Headset Status & Connection Bar */}
            <div className="px-3 pt-2.5 pb-1">
              <AudioRoutingControl
                userId={currentUser.userId}
                language={currentUser.preferredLanguage}
                isInCall={false}
              />
            </div>

            {/* TAB CONTENT AREA */}
            <div className="flex-1 overflow-y-auto">
              {/* TAB 1: CHATS */}
              {activeTab === 'chats' && (
                <div className="p-2 space-y-1">
                  <div
                    onClick={() => setCurrentScreen('chat_detail')}
                    className="p-3 bg-slate-900/80 hover:bg-slate-900 border border-slate-800/80 rounded-2xl flex items-center gap-3 cursor-pointer transition active:scale-[0.99]"
                  >
                    <div className="relative">
                      <img
                        src={peerUser.profilePhotoUrl}
                        alt={peerUser.fullName}
                        className="w-12 h-12 rounded-full object-cover border border-slate-700"
                        referrerPolicy="no-referrer"
                      />
                      {peerUser.isOnline && (
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full ring-2 ring-slate-900" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-xs font-semibold text-white truncate">
                          {peerUser.fullName}
                        </h4>
                        <span className="text-[10px] text-slate-400">
                          {messages.length > 0
                            ? formatTime(messages[messages.length - 1].timestamp)
                            : ''}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {messages.length > 0
                          ? messages[messages.length - 1].type === 'VOICE'
                            ? `🎤 ${t.voiceMessage}`
                            : messages[messages.length - 1].text
                          : t.noChatsYet}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: CONTACTS */}
              {activeTab === 'contacts' && (
                <div className="p-3 space-y-3">
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-white">{t.syncContacts}</h4>
                      <button
                        onClick={handleSyncContactsClick}
                        disabled={isSyncing}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-medium rounded-lg flex items-center gap-1 transition"
                      >
                        <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                        <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      {t.syncContactsDesc}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
                      {t.registeredOnKotha} ({contacts.filter((c) => c.isKothaUser).length})
                    </span>

                    {contacts.map((contact) => (
                      <div
                        key={contact.id}
                        className="p-2.5 bg-slate-900/60 border border-slate-800/60 rounded-xl flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          {contact.kothaProfilePhoto ? (
                            <img
                              src={contact.kothaProfilePhoto}
                              alt={contact.displayName}
                              className="w-9 h-9 rounded-full object-cover border border-slate-700"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-xs">
                              {contact.displayName[0]}
                            </div>
                          )}
                          <div>
                            <h5 className="text-xs font-semibold text-white">
                              {contact.displayName}
                            </h5>
                            <p className="text-[10px] text-slate-400 font-mono">
                              {contact.phoneNumber}
                            </p>
                          </div>
                        </div>

                        {contact.isKothaUser ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setCurrentScreen('chat_detail');
                              }}
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg"
                              title="Chat"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onInitiateCall('AUDIO')}
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg"
                              title="Call"
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[9px] px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md">
                            {t.inviteToKotha}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 3: CALL HISTORY */}
              {activeTab === 'calls' && (
                <div className="p-3 space-y-2">
                  {callHistory.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 text-xs">{t.noCallsYet}</div>
                  ) : (
                    callHistory.map((call) => (
                      <div
                        key={call.callId}
                        className="p-3 bg-slate-900/70 border border-slate-800/80 rounded-2xl flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={call.peerPhotoUrl}
                            alt={call.peerName}
                            className="w-10 h-10 rounded-full object-cover border border-slate-700"
                            referrerPolicy="no-referrer"
                          />
                          <div>
                            <h5 className="text-xs font-semibold text-white">{call.peerName}</h5>
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                              {call.direction === 'INCOMING' ? (
                                <PhoneIncoming className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <PhoneOutgoing className="w-3 h-3 text-blue-400" />
                              )}
                              <span>{call.callType}</span>
                              <span>•</span>
                              <span>{call.durationSeconds}s</span>
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {formatTime(call.timestamp)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 4: SETTINGS & PROFILE */}
              {activeTab === 'settings' && (
                <div className="p-4 space-y-4">
                  {/* Profile Edit Card */}
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={currentUser.profilePhotoUrl}
                        alt={currentUser.fullName}
                        className="w-12 h-12 rounded-full object-cover border-2 border-emerald-500/50"
                        referrerPolicy="no-referrer"
                      />
                      <div className="flex-1">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full bg-slate-800 text-xs font-semibold text-white px-2 py-1 rounded border border-slate-700 outline-none"
                          placeholder={t.fullNameLabel}
                        />
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {currentUser.phoneNumber}
                        </p>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={editAbout}
                      onChange={(e) => setEditAbout(e.target.value)}
                      className="w-full bg-slate-800 text-xs text-slate-300 px-2 py-1 rounded border border-slate-700 outline-none"
                      placeholder={t.aboutLabel}
                    />

                    <button
                      onClick={() => onUpdateProfile(editName, editAbout)}
                      className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition cursor-pointer"
                    >
                      {t.save}
                    </button>
                  </div>

                  {/* Low Data Mode Switch */}
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
                    <div className="pr-3">
                      <h5 className="text-xs font-semibold text-white">{t.lowDataMode}</h5>
                      <p className="text-[10px] text-slate-400 leading-tight">
                        {t.lowDataModeDesc}
                      </p>
                    </div>
                    <button
                      onClick={onToggleLowDataMode}
                      className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                        currentUser.lowDataMode ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                          currentUser.lowDataMode ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Security & Firebase Sync Indicator */}
                  <div className="p-3 bg-slate-900/50 border border-slate-800/80 rounded-2xl space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                      <ShieldCheck className="w-4 h-4" />
                      <span>Firebase & WebRTC Security</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      End-to-end P2P signaling via Firestore rules. All voice notes stored in
                      encrypted buckets.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Navigation Bar */}
            <div className="p-2 bg-slate-900 border-t border-slate-800 grid grid-cols-4 gap-1">
              <button
                onClick={() => setActiveTab('chats')}
                className={`py-1.5 flex flex-col items-center gap-1 rounded-xl transition cursor-pointer ${
                  activeTab === 'chats' ? 'text-emerald-400 font-bold' : 'text-slate-400'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                <span className="text-[10px]">{t.chats}</span>
              </button>

              <button
                onClick={() => setActiveTab('contacts')}
                className={`py-1.5 flex flex-col items-center gap-1 rounded-xl transition cursor-pointer ${
                  activeTab === 'contacts' ? 'text-emerald-400 font-bold' : 'text-slate-400'
                }`}
              >
                <Users className="w-4 h-4" />
                <span className="text-[10px]">{t.contacts}</span>
              </button>

              <button
                onClick={() => setActiveTab('calls')}
                className={`py-1.5 flex flex-col items-center gap-1 rounded-xl transition cursor-pointer ${
                  activeTab === 'calls' ? 'text-emerald-400 font-bold' : 'text-slate-400'
                }`}
              >
                <Phone className="w-4 h-4" />
                <span className="text-[10px]">{t.calls}</span>
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`py-1.5 flex flex-col items-center gap-1 rounded-xl transition cursor-pointer ${
                  activeTab === 'settings' ? 'text-emerald-400 font-bold' : 'text-slate-400'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span className="text-[10px]">{t.settings}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Android Hardware Home Pill */}
      <div className="w-28 h-1 bg-slate-600 rounded-full mx-auto mt-2 opacity-60" />
    </div>
  );
};
