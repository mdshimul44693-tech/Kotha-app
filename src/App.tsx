import React, { useState, useEffect, useRef } from 'react';
import {
  UserProfile,
  ChatMessage,
  DeviceContact,
  CallRecord,
  WebRtcCallSession,
  CallType,
  Language,
} from './types';
import {
  initialUserA,
  initialUserB,
  initialDeviceContactsForA,
  initialMessages,
  initialCallHistory,
} from './data/initialData';
import { PhoneSimulator } from './components/PhoneSimulator';
import { AndroidProjectExplorer } from './components/AndroidProjectExplorer';
import {
  playIncomingRingtone,
  playOutgoingBeep,
  playCallEndSound,
  stopRingtone,
  unlockAudioContext,
} from './utils/audioUtils';
import {
  getDirectChatId,
  syncUserProfileToFirestore,
  subscribeToChatMessages,
  fetchOlderChatMessages,
  sendFirestoreMessage,
  markMessagesAsRead,
  createCallSignalingSession,
  subscribeToIncomingCalls,
  subscribeToActiveCallSession,
  updateCallStateInFirestore,
  saveCallRecordToFirestore,
  subscribeToCallHistory,
} from './lib/firestoreService';
import {
  acquireMediaStream,
  WebRtcCallController,
} from './lib/webrtcManager';
import { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import {
  Smartphone,
  Layers,
  Sparkles,
  Wifi,
  ShieldCheck,
  Globe,
  Radio,
  RefreshCw,
  Code2,
  Database,
} from 'lucide-react';

export function App() {
  const [userA, setUserA] = useState<UserProfile>(initialUserA);
  const [userB, setUserB] = useState<UserProfile>(initialUserB);
  const [contactsA, setContactsA] = useState<DeviceContact[]>(initialDeviceContactsForA);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [callHistoryA, setCallHistoryA] = useState<CallRecord[]>(initialCallHistory);
  const [callHistoryB, setCallHistoryB] = useState<CallRecord[]>([]);
  const [activeCall, setActiveCall] = useState<WebRtcCallSession | null>(null);
  const [callInitiatorId, setCallInitiatorId] = useState<string | null>(null);
  const [activeViewMode, setActiveViewMode] = useState<'dual' | 'deviceA' | 'deviceB' | 'code'>(
    'dual'
  );
  const [isFirestoreConnected, setIsFirestoreConnected] = useState<boolean>(true);
  const [oldestDocSnapshot, setOldestDocSnapshot] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState<boolean>(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState<boolean>(false);

  const [localStreamA, setLocalStreamA] = useState<MediaStream | null>(null);
  const [localStreamB, setLocalStreamB] = useState<MediaStream | null>(null);
  const [remoteStreamA, setRemoteStreamA] = useState<MediaStream | null>(null);
  const [remoteStreamB, setRemoteStreamB] = useState<MediaStream | null>(null);

  const controllerARef = useRef<WebRtcCallController | null>(null);
  const controllerBRef = useRef<WebRtcCallController | null>(null);
  const callInitiatorIdRef = useRef<string | null>(null);

  const chatId = getDirectChatId(userA.userId, userB.userId);

  // Sync users to Firestore on initial load
  useEffect(() => {
    syncUserProfileToFirestore(userA).catch(console.error);
    syncUserProfileToFirestore(userB).catch(console.error);

    const unsubHistoryA = subscribeToCallHistory(userA.userId, (history) => {
      if (history && history.length > 0) {
        setCallHistoryA(history);
      }
    });

    const unsubHistoryB = subscribeToCallHistory(userB.userId, (history) => {
      if (history && history.length > 0) {
        setCallHistoryB(history);
      }
    });

    return () => {
      unsubHistoryA();
      unsubHistoryB();
    };
  }, []);

  // Subscribe to real-time messages between User A and User B with query pagination (limit 25)
  useEffect(() => {
    try {
      const unsubscribe = subscribeToChatMessages(
        chatId,
        (liveMessages, oldestDoc, hasMore) => {
          if (liveMessages && liveMessages.length > 0) {
            setMessages((prev) => {
              const liveIds = new Set(liveMessages.map((m) => m.messageId));
              const older = prev.filter(
                (m) => !liveIds.has(m.messageId) && m.timestamp < liveMessages[0].timestamp
              );
              return [...older, ...liveMessages];
            });
            if (oldestDoc) {
              setOldestDocSnapshot(oldestDoc);
            }
            if (hasMore !== undefined) {
              setHasMoreOlderMessages(hasMore);
            }
          }
        },
        25
      );
      return () => unsubscribe();
    } catch (err) {
      console.warn('Firestore subscription fallback:', err);
    }
  }, [chatId]);

  // Load older message history on scroll using startAfter pagination
  const handleLoadOlderMessages = async () => {
    if (!oldestDocSnapshot || isLoadingOlderMessages || !hasMoreOlderMessages) return;
    setIsLoadingOlderMessages(true);
    try {
      const result = await fetchOlderChatMessages(chatId, oldestDocSnapshot, 20);
      if (result.messages.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.messageId));
          const newOlder = result.messages.filter((m) => !existingIds.has(m.messageId));
          return [...newOlder, ...prev];
        });
        setOldestDocSnapshot(result.oldestDocSnapshot);
        setHasMoreOlderMessages(result.hasMore);
      } else {
        setHasMoreOlderMessages(false);
      }
    } catch (err) {
      console.warn('Load older messages notice:', err);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  };

  // Subscribe to real-time incoming calls in Firestore for User A and User B
  useEffect(() => {
    const unsubA = subscribeToIncomingCalls(userA.userId, (incomingCall) => {
      if (incomingCall) {
        setActiveCall((prev) => {
          if (prev && prev.callId === incomingCall.callId && (prev.callState === 'CONNECTING' || prev.callState === 'CONNECTED')) {
            return prev;
          }
          return incomingCall;
        });
        setCallInitiatorId(incomingCall.callerId);
        callInitiatorIdRef.current = incomingCall.callerId;
        playIncomingRingtone();
      } else {
        setActiveCall((prev) => {
          if (prev && prev.receiverId === userA.userId && prev.callState === 'RINGING') {
            stopRingtone();
            setCallInitiatorId(null);
            callInitiatorIdRef.current = null;
            return null;
          }
          return prev;
        });
      }
    });

    const unsubB = subscribeToIncomingCalls(userB.userId, (incomingCall) => {
      if (incomingCall) {
        setActiveCall((prev) => {
          if (prev && prev.callId === incomingCall.callId && (prev.callState === 'CONNECTING' || prev.callState === 'CONNECTED')) {
            return prev;
          }
          return incomingCall;
        });
        setCallInitiatorId(incomingCall.callerId);
        callInitiatorIdRef.current = incomingCall.callerId;
        playIncomingRingtone();
      } else {
        setActiveCall((prev) => {
          if (prev && prev.receiverId === userB.userId && prev.callState === 'RINGING') {
            stopRingtone();
            setCallInitiatorId(null);
            callInitiatorIdRef.current = null;
            return null;
          }
          return prev;
        });
      }
    });

    return () => {
      unsubA();
      unsubB();
    };
  }, [userA.userId, userB.userId]);

  // Synchronize active call session updates (SDP answer, state transitions, hangup) in real-time
  useEffect(() => {
    if (!activeCall?.callId) return;
    const callId = activeCall.callId;

    const unsub = subscribeToActiveCallSession(callId, async (session) => {
      if (!session) return;

      if (session.callState === 'CONNECTED') {
        stopRingtone();
        // If caller receives answer SDP
        if (session.answer) {
          const isCallerA = callInitiatorIdRef.current === userA.userId;
          const callerController = isCallerA ? controllerARef.current : controllerBRef.current;
          if (callerController) {
            await callerController.applyAnswer(session.answer).catch(console.error);
          }
        }
        setActiveCall((prev) => {
          const authConnectedAt = session.connectedAt || prev?.connectedAt || Date.now();
          return prev
            ? { ...prev, ...session, callState: 'CONNECTED', connectedAt: authConnectedAt }
            : { ...session, callState: 'CONNECTED', connectedAt: authConnectedAt };
        });
      } else if (session.callState === 'ENDED' || session.callState === 'REJECTED') {
        stopRingtone();
        playCallEndSound();
        controllerARef.current?.cleanup();
        controllerBRef.current?.cleanup();
        controllerARef.current = null;
        controllerBRef.current = null;
        setLocalStreamA(null);
        setLocalStreamB(null);
        setRemoteStreamA(null);
        setRemoteStreamB(null);
        setActiveCall(null);
        setCallInitiatorId(null);
        callInitiatorIdRef.current = null;
      }
    });

    return () => unsub();
  }, [activeCall?.callId]);

  // Handle outgoing call initiation with WebRTC SDP offer & Firestore signaling
  const handleInitiateCall = async (initiator: 'A' | 'B', type: CallType) => {
    unlockAudioContext();
    const caller = initiator === 'A' ? userA : userB;
    const receiver = initiator === 'A' ? userB : userA;

    setCallInitiatorId(caller.userId);
    callInitiatorIdRef.current = caller.userId;

    const newCallId = `call_${Date.now()}`;
    const session: WebRtcCallSession = {
      callId: newCallId,
      callerId: caller.userId,
      callerName: caller.fullName,
      callerPhoto: caller.profilePhotoUrl,
      receiverId: receiver.userId,
      receiverName: receiver.fullName,
      receiverPhoto: receiver.profilePhotoUrl,
      callType: type,
      callState: 'RINGING',
      startedAt: Date.now(),
      isMuted: false,
      isCameraOff: false,
      isSpeakerOn: true,
      isFrontCamera: true,
      callerCameraOff: false,
      receiverCameraOff: false,
      callerFrontCamera: true,
      receiverFrontCamera: true,
      callerMuted: false,
      receiverMuted: false,
      lowDataMode: caller.lowDataMode || receiver.lowDataMode,
    };

    setActiveCall(session);

    // Acquire caller audio/video stream
    let stream: MediaStream;
    try {
      stream = await acquireMediaStream(type, session.lowDataMode, 'caller');
    } catch (err) {
      console.error('Failed to acquire caller media stream:', err);
      alert((err as Error)?.message || 'Microphone permission is required to place a call.');
      setActiveCall(null);
      setCallInitiatorId(null);
      callInitiatorIdRef.current = null;
      return;
    }

    if (initiator === 'A') {
      setLocalStreamA(stream);
    } else {
      setLocalStreamB(stream);
    }

    // Initialize Caller WebRtcCallController
    const controller = new WebRtcCallController(
      newCallId,
      true,
      (remoteStream) => {
        if (initiator === 'A') {
          setRemoteStreamA(remoteStream);
        } else {
          setRemoteStreamB(remoteStream);
        }
      },
      (state) => {
        if (state === 'connected') {
          console.log(`[Caller] WebRTC connection established. Transitioning state to CONNECTED.`);
          setActiveCall((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              callState: 'CONNECTED',
              connectedAt: prev.connectedAt || Date.now(),
            };
          });
        }
      }
    );

    if (initiator === 'A') {
      controllerARef.current = controller;
    } else {
      controllerBRef.current = controller;
    }

    await controller.initConnection(stream);
    const offer = await controller.createAndSendOffer(type);

    // Save session to Firestore with SDP offer
    session.offer = { type: offer.type, sdp: offer.sdp || '' };
    createCallSignalingSession(session).catch(console.error);

    // Play incoming ringtone on receiver side while outgoing call remains active
    playIncomingRingtone();
  };

  // Answer call: Acquire receiver stream, handle SDP offer, produce SDP answer, transition to CONNECTING then CONNECTED
  const handleAnswerCall = async (answeringUser: 'A' | 'B') => {
    stopRingtone();
    unlockAudioContext();
    if (!activeCall) return;

    const callId = activeCall.callId;

    // Transition state to CONNECTING immediately (NOT marked CONNECTED until WebRTC media connection connects)
    setActiveCall((prev) =>
      prev
        ? {
            ...prev,
            callState: 'CONNECTING',
          }
        : null
    );

    updateCallStateInFirestore(callId, {
      callState: 'CONNECTING',
    }).catch(console.error);

    // Acquire receiver local stream
    let stream: MediaStream;
    try {
      stream = await acquireMediaStream(
        activeCall.callType,
        activeCall.lowDataMode,
        'receiver'
      );
    } catch (err) {
      console.error('Failed to acquire receiver media stream:', err);
      alert((err as Error)?.message || 'Microphone access is required to answer this call.');
      handleEndCall();
      return;
    }

    if (answeringUser === 'A') {
      setLocalStreamA(stream);
    } else {
      setLocalStreamB(stream);
    }

    // Initialize Receiver WebRtcCallController
    const controller = new WebRtcCallController(
      callId,
      false,
      (remoteStream) => {
        if (answeringUser === 'A') {
          setRemoteStreamA(remoteStream);
        } else {
          setRemoteStreamB(remoteStream);
        }
      },
      (state) => {
        if (state === 'connected') {
          console.log(`[Receiver] WebRTC connection established. Transitioning state to CONNECTED.`);
          const establishedTime = Date.now();
          setActiveCall((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              callState: 'CONNECTED',
              connectedAt: prev.connectedAt || establishedTime,
            };
          });

          updateCallStateInFirestore(callId, {
            callState: 'CONNECTED',
            connectedAt: establishedTime,
          }).catch(console.error);
        }
      }
    );

    if (answeringUser === 'A') {
      controllerARef.current = controller;
    } else {
      controllerBRef.current = controller;
    }

    await controller.initConnection(stream);

    if (activeCall.offer) {
      await controller.handleAndAnswerOffer(activeCall.offer, activeCall.callType);
    }
  };

  // End call
  const handleEndCall = () => {
    stopRingtone();
    playCallEndSound();

    controllerARef.current?.cleanup();
    controllerBRef.current?.cleanup();
    controllerARef.current = null;
    controllerBRef.current = null;

    if (localStreamA) {
      localStreamA.getTracks().forEach((t) => t.stop());
      setLocalStreamA(null);
    }
    if (localStreamB) {
      localStreamB.getTracks().forEach((t) => t.stop());
      setLocalStreamB(null);
    }
    setRemoteStreamA(null);
    setRemoteStreamB(null);

    if (activeCall) {
      updateCallStateInFirestore(activeCall.callId, {
        callState: 'ENDED',
        endedAt: Date.now(),
      }).catch(console.error);

      if (activeCall.connectedAt) {
        const duration = Math.max(1, Math.floor((Date.now() - activeCall.connectedAt) / 1000));
        const recordA: CallRecord = {
          callId: activeCall.callId,
          peerId: userB.userId,
          peerName: userB.fullName,
          peerPhotoUrl: userB.profilePhotoUrl,
          peerPhone: userB.phoneNumber,
          callType: activeCall.callType,
          direction: callInitiatorId === userA.userId ? 'OUTGOING' : 'INCOMING',
          status: 'ANSWERED',
          timestamp: Date.now(),
          durationSeconds: duration,
        };
        const recordB: CallRecord = {
          callId: activeCall.callId,
          peerId: userA.userId,
          peerName: userA.fullName,
          peerPhotoUrl: userA.profilePhotoUrl,
          peerPhone: userA.phoneNumber,
          callType: activeCall.callType,
          direction: callInitiatorId === userB.userId ? 'OUTGOING' : 'INCOMING',
          status: 'ANSWERED',
          timestamp: Date.now(),
          durationSeconds: duration,
        };
        setCallHistoryA((prev) => [recordA, ...prev]);
        setCallHistoryB((prev) => [recordB, ...prev]);
        saveCallRecordToFirestore(userA.userId, recordA).catch(console.error);
        saveCallRecordToFirestore(userB.userId, recordB).catch(console.error);
      }
    }

    setActiveCall(null);
    setCallInitiatorId(null);
    callInitiatorIdRef.current = null;
  };

  // Send message to Firestore
  const handleSendMessage = (
    senderId: string,
    receiverId: string,
    text: string,
    type: 'TEXT' | 'VOICE' = 'TEXT',
    mediaUrl?: string,
    duration?: number
  ) => {
    const newMsg: ChatMessage = {
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      senderId,
      receiverId,
      text: type === 'TEXT' ? text : undefined,
      type,
      mediaUrl,
      mediaDurationMs: duration,
      timestamp: Date.now(),
      status: 'DELIVERED',
    };

    // Optimistic local update
    setMessages((prev) => [...prev, newMsg]);

    // Send to Firestore
    sendFirestoreMessage(chatId, {
      senderId,
      receiverId,
      text: type === 'TEXT' ? text : undefined,
      type,
      mediaUrl,
      mediaDurationMs: duration,
      timestamp: Date.now(),
      status: 'DELIVERED',
    }).catch(console.error);

    // Mark as READ after a short delay
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.messageId === newMsg.messageId ? { ...m, status: 'READ' } : m))
      );
      markMessagesAsRead(chatId, receiverId).catch(console.error);
    }, 1200);
  };

  // Toggle Mute per device
  const handleToggleMute = (device: 'A' | 'B' = 'A') => {
    setActiveCall((prev) => {
      if (!prev) return null;
      const updatedMute = !prev.isMuted;
      if (device === 'A') {
        controllerARef.current?.toggleMute(updatedMute);
        if (localStreamA) {
          localStreamA.getAudioTracks().forEach((t) => {
            t.enabled = !updatedMute;
          });
        }
      } else {
        controllerBRef.current?.toggleMute(updatedMute);
        if (localStreamB) {
          localStreamB.getAudioTracks().forEach((t) => {
            t.enabled = !updatedMute;
          });
        }
      }
      updateCallStateInFirestore(prev.callId, { isMuted: updatedMute }).catch(console.error);
      return { ...prev, isMuted: updatedMute };
    });
  };

  // Toggle Camera per device
  const handleToggleCamera = (device: 'A' | 'B' = 'A') => {
    setActiveCall((prev) => {
      if (!prev) return null;
      const isDeviceA = device === 'A';
      const prevCamOff = isDeviceA
        ? (prev.callerCameraOff ?? prev.isCameraOff)
        : (prev.receiverCameraOff ?? prev.isCameraOff);
      const updatedCam = !prevCamOff;

      if (isDeviceA) {
        controllerARef.current?.toggleCamera(updatedCam);
        if (localStreamA) {
          localStreamA.getVideoTracks().forEach((t) => {
            t.enabled = !updatedCam;
          });
        }
      } else {
        controllerBRef.current?.toggleCamera(updatedCam);
        if (localStreamB) {
          localStreamB.getVideoTracks().forEach((t) => {
            t.enabled = !updatedCam;
          });
        }
      }

      const updates = isDeviceA
        ? { callerCameraOff: updatedCam, isCameraOff: updatedCam }
        : { receiverCameraOff: updatedCam };
      updateCallStateInFirestore(prev.callId, updates).catch(console.error);
      return { ...prev, ...updates };
    });
  };

  // Toggle Speaker
  const handleToggleSpeaker = () => {
    setActiveCall((prev) => (prev ? { ...prev, isSpeakerOn: !prev.isSpeakerOn } : null));
  };

  // Switch Camera (front/rear) per device
  const handleSwitchCamera = async (device: 'A' | 'B' = 'A') => {
    const isDeviceA = device === 'A';
    const currentIsFront = isDeviceA
      ? (activeCall?.callerFrontCamera ?? activeCall?.isFrontCamera ?? true)
      : (activeCall?.receiverFrontCamera ?? true);
    const newIsFront = !currentIsFront;
    const newFacingMode: 'user' | 'environment' = newIsFront ? 'user' : 'environment';

    if (isDeviceA) {
      if (controllerARef.current) {
        const newTrack = await controllerARef.current.switchCamera(newFacingMode);
        if (newTrack && localStreamA) {
          setLocalStreamA(new MediaStream(localStreamA.getTracks()));
        }
      }
    } else {
      if (controllerBRef.current) {
        const newTrack = await controllerBRef.current.switchCamera(newFacingMode);
        if (newTrack && localStreamB) {
          setLocalStreamB(new MediaStream(localStreamB.getTracks()));
        }
      }
    }

    setActiveCall((prev) => {
      if (!prev) return null;
      const updates = isDeviceA
        ? { callerFrontCamera: newIsFront, isFrontCamera: newIsFront }
        : { receiverFrontCamera: newIsFront };
      updateCallStateInFirestore(prev.callId, updates).catch(console.error);
      return { ...prev, ...updates };
    });
  };

  // Switch between Audio and Video Call in real-time
  const handleSwitchCallType = async (newType: CallType) => {
    if (!activeCall) return;
    const callId = activeCall.callId;

    if (newType === 'VIDEO') {
      // Transition from Voice to Video: acquire camera video tracks
      try {
        if (!localStreamA?.getVideoTracks().length) {
          const videoStreamA = await acquireMediaStream('VIDEO', activeCall.lowDataMode, 'caller', 'user');
          const videoTrackA = videoStreamA.getVideoTracks()[0];
          if (videoTrackA && localStreamA) {
            localStreamA.addTrack(videoTrackA);
            controllerARef.current?.addVideoTrack(videoTrackA);
            setLocalStreamA(new MediaStream(localStreamA.getTracks()));
          }
        }
        if (!localStreamB?.getVideoTracks().length) {
          const videoStreamB = await acquireMediaStream('VIDEO', activeCall.lowDataMode, 'receiver', 'user');
          const videoTrackB = videoStreamB.getVideoTracks()[0];
          if (videoTrackB && localStreamB) {
            localStreamB.addTrack(videoTrackB);
            controllerBRef.current?.addVideoTrack(videoTrackB);
            setLocalStreamB(new MediaStream(localStreamB.getTracks()));
          }
        }
      } catch (e) {
        console.warn('Switch to video call camera acquisition notice:', e);
      }
    } else {
      // Transition from Video to Voice: remove and release video tracks
      controllerARef.current?.removeVideoTracks();
      controllerBRef.current?.removeVideoTracks();
      if (localStreamA) {
        localStreamA.getVideoTracks().forEach((t) => t.stop());
        setLocalStreamA(new MediaStream(localStreamA.getAudioTracks()));
      }
      if (localStreamB) {
        localStreamB.getVideoTracks().forEach((t) => t.stop());
        setLocalStreamB(new MediaStream(localStreamB.getAudioTracks()));
      }
    }

    setActiveCall((prev) => (prev ? { ...prev, callType: newType } : null));
    updateCallStateInFirestore(callId, { callType: newType }).catch(console.error);
  };

  // Contact Sync
  const handleSyncContacts = () => {
    // Normalizes phone numbers and cross matches registered Kotha users
    setContactsA((prev) =>
      prev.map((c) => {
        if (c.phoneNumber.includes('88018')) {
          return {
            ...c,
            isKothaUser: true,
            kothaUserId: userB.userId,
            kothaProfilePhoto: userB.profilePhotoUrl,
            about: userB.about,
          };
        }
        return c;
      })
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Banner Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center font-bold text-white shadow-lg shadow-emerald-500/20">
              ক
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-tight">Kotha (কথা)</h1>
                <span className="text-[11px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full font-medium">
                  Android Clean Architecture
                </span>
                <span className="text-[11px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full font-medium flex items-center gap-1">
                  <Database className="w-3 h-3" />
                  Live Firestore Cloud
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Production-ready Real-time Messaging, WebRTC Voice & Video Calls, and Bilingual
                Support
              </p>
            </div>
          </div>

          {/* View Mode Controls */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveViewMode('dual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                activeViewMode === 'dual'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Dual Device Testing</span>
            </button>
            <button
              onClick={() => setActiveViewMode('deviceA')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                activeViewMode === 'deviceA'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Device 1</span>
            </button>
            <button
              onClick={() => setActiveViewMode('deviceB')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                activeViewMode === 'deviceB'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Device 2</span>
            </button>
            <button
              onClick={() => setActiveViewMode('code')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                activeViewMode === 'code'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Android Code</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-8 space-y-8">
        {/* Device Testing View */}
        {activeViewMode !== 'code' && (
          <div className="space-y-6">
            {/* Live Signaling Status Badge */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-900/70 border border-slate-800 rounded-2xl">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                </span>
                <span className="text-xs text-slate-300 font-medium">
                  Live Firestore Real-Time Signaling Engine: <strong>Active & Connected</strong>
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span>WebRTC: Peer-to-Peer</span>
                <span>•</span>
                <span>FCM Direct Wake: Enabled</span>
                <span>•</span>
                <span>Bangla (বাংলা) / English: Dynamic</span>
              </div>
            </div>

            {/* Simulators Grid */}
            <div className="flex flex-col lg:flex-row items-center justify-center gap-8 lg:gap-12">
              {/* DEVICE A */}
              {(activeViewMode === 'dual' || activeViewMode === 'deviceA') && (
                <div className="flex flex-col items-center space-y-3">
                  <div className="text-center">
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                      Device 1 (Tahmid - Dhaka)
                    </span>
                    <p className="text-[11px] text-slate-400 font-mono">+880 1712-345678</p>
                  </div>

                  <PhoneSimulator
                    currentUser={userA}
                    peerUser={userB}
                    contacts={contactsA}
                    messages={messages}
                    callHistory={callHistoryA}
                    activeCall={activeCall}
                    onSendMessage={(text, type, url, dur) =>
                      handleSendMessage(userA.userId, userB.userId, text, type, url, dur)
                    }
                    onInitiateCall={(type) => handleInitiateCall('A', type)}
                    onAnswerCall={() => handleAnswerCall('A')}
                    onEndCall={handleEndCall}
                    onToggleMute={() => handleToggleMute('A')}
                    onToggleCamera={() => handleToggleCamera('A')}
                    onToggleSpeaker={handleToggleSpeaker}
                    onSwitchCamera={() => handleSwitchCamera('A')}
                    onSwitchCallType={handleSwitchCallType}
                    onUpdateProfile={(name, about) =>
                      setUserA((prev) => ({ ...prev, fullName: name, about }))
                    }
                    onToggleLowDataMode={() =>
                      setUserA((prev) => ({ ...prev, lowDataMode: !prev.lowDataMode }))
                    }
                    onChangeLanguage={(lang) =>
                      setUserA((prev) => ({ ...prev, preferredLanguage: lang }))
                    }
                    onSyncContacts={handleSyncContacts}
                    isCallInitiator={callInitiatorId === userA.userId}
                    localMediaStream={localStreamA}
                    remoteMediaStream={
                      remoteStreamA ||
                      (activeCall?.callState === 'CONNECTED' ? localStreamB : null)
                    }
                    onLoadOlderMessages={handleLoadOlderMessages}
                    hasMoreOlderMessages={hasMoreOlderMessages}
                    isLoadingOlderMessages={isLoadingOlderMessages}
                  />
                </div>
              )}

              {/* DEVICE B */}
              {(activeViewMode === 'dual' || activeViewMode === 'deviceB') && (
                <div className="flex flex-col items-center space-y-3">
                  <div className="text-center">
                    <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                      Device 2 (Nabila - Chittagong)
                    </span>
                    <p className="text-[11px] text-slate-400 font-mono">+880 1898-765432</p>
                  </div>

                  <PhoneSimulator
                    currentUser={userB}
                    peerUser={userA}
                    contacts={[
                      {
                        id: 'cb1',
                        displayName: 'Tahmid Rahman (তাহমিদ)',
                        phoneNumber: '+8801712345678',
                        isKothaUser: true,
                        kothaUserId: userA.userId,
                        kothaProfilePhoto: userA.profilePhotoUrl,
                        about: userA.about,
                      },
                    ]}
                    messages={messages}
                    callHistory={callHistoryB}
                    activeCall={activeCall}
                    onSendMessage={(text, type, url, dur) =>
                      handleSendMessage(userB.userId, userA.userId, text, type, url, dur)
                    }
                    onInitiateCall={(type) => handleInitiateCall('B', type)}
                    onAnswerCall={() => handleAnswerCall('B')}
                    onEndCall={handleEndCall}
                    onToggleMute={() => handleToggleMute('B')}
                    onToggleCamera={() => handleToggleCamera('B')}
                    onToggleSpeaker={handleToggleSpeaker}
                    onSwitchCamera={() => handleSwitchCamera('B')}
                    onSwitchCallType={handleSwitchCallType}
                    onUpdateProfile={(name, about) =>
                      setUserB((prev) => ({ ...prev, fullName: name, about }))
                    }
                    onToggleLowDataMode={() =>
                      setUserB((prev) => ({ ...prev, lowDataMode: !prev.lowDataMode }))
                    }
                    onChangeLanguage={(lang) =>
                      setUserB((prev) => ({ ...prev, preferredLanguage: lang }))
                    }
                    onSyncContacts={() => {}}
                    isCallInitiator={callInitiatorId === userB.userId}
                    localMediaStream={localStreamB}
                    remoteMediaStream={
                      remoteStreamB ||
                      (activeCall?.callState === 'CONNECTED' ? localStreamA : null)
                    }
                    onLoadOlderMessages={handleLoadOlderMessages}
                    hasMoreOlderMessages={hasMoreOlderMessages}
                    isLoadingOlderMessages={isLoadingOlderMessages}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Android Production Source Code & Architecture Explorer */}
        <AndroidProjectExplorer />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500">
        Kotha (কথা) Communication App • Clean Architecture • Jetpack Compose • WebRTC • Firebase
      </footer>
    </div>
  );
}


