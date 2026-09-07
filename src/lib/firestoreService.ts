import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  addDoc,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  UserProfile,
  ChatMessage,
  DirectChat,
  CallRecord,
  WebRtcCallSession,
  CallType,
  CallState,
} from '../types';

// Deterministic Direct Chat ID Generator (Clean Architecture standard)
export function getDirectChatId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

// User Profile Service
export async function syncUserProfileToFirestore(profile: UserProfile): Promise<void> {
  const userRef = doc(db, 'users', profile.userId);
  await setDoc(
    userRef,
    {
      ...profile,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const userRef = doc(db, 'users', userId);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    return snap.data() as UserProfile;
  }
  return null;
}

export function subscribeToUserProfile(userId: string, callback: (user: UserProfile | null) => void) {
  const userRef = doc(db, 'users', userId);
  return onSnapshot(
    userRef,
    (snap) => {
      if (snap.exists()) {
        callback(snap.data() as UserProfile);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn('Firestore user profile snapshot notice:', err);
    }
  );
}

// Match phone numbers with registered Firestore users
export async function matchPhoneNumbersWithFirestore(phoneNumbers: string[]): Promise<UserProfile[]> {
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    const matched: UserProfile[] = [];
    
    // Normalize target set
    const cleanNumbers = phoneNumbers.map((p) => p.replace(/\D/g, '').slice(-10));

    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as UserProfile;
      const userPhoneClean = (data.phoneNumber || '').replace(/\D/g, '').slice(-10);
      if (cleanNumbers.includes(userPhoneClean)) {
        matched.push(data);
      }
    });

    return matched;
  } catch (err) {
    console.warn('Firestore contact matching notice:', err);
    return [];
  }
}

export interface ChatPaginationResult {
  messages: ChatMessage[];
  oldestDocSnapshot: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/**
 * Subscribes to real-time chat messages using limit-based pagination.
 * Retrieves the most recent N messages and yields the oldest document snapshot for subsequent startAfter queries.
 */
export function subscribeToChatMessages(
  chatId: string,
  callback: (messages: ChatMessage[], oldestDoc?: QueryDocumentSnapshot<DocumentData> | null, hasMore?: boolean) => void,
  pageSize: number = 25
) {
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  // Order descending by timestamp with limit to only fetch recent messages
  const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(pageSize));

  return onSnapshot(
    q,
    (snapshot) => {
      const msgs: ChatMessage[] = [];
      snapshot.forEach((docSnap) => {
        msgs.push({
          messageId: docSnap.id,
          ...(docSnap.data() as Omit<ChatMessage, 'messageId'>),
        });
      });
      // Sort ascending (chronological order) for chat UI display
      const chronological = msgs.sort((a, b) => a.timestamp - b.timestamp);
      // The oldest document in the currently loaded snapshot is the last document in descending order
      const oldestDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
      const hasMore = snapshot.docs.length >= pageSize;

      callback(chronological, oldestDoc, hasMore);
    },
    (err) => {
      console.warn('Firestore chat messages snapshot notice:', err);
    }
  );
}

/**
 * Fetches an older batch of chat history using Firestore startAfter pagination cursor.
 * Triggered on scroll to load older messages lazily without performance degradation.
 */
export async function fetchOlderChatMessages(
  chatId: string,
  oldestDocSnapshot: QueryDocumentSnapshot<DocumentData>,
  pageSize: number = 25
): Promise<ChatPaginationResult> {
  try {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(
      messagesRef,
      orderBy('timestamp', 'desc'),
      startAfter(oldestDocSnapshot),
      limit(pageSize)
    );

    const snapshot = await getDocs(q);
    const msgs: ChatMessage[] = [];
    snapshot.forEach((docSnap) => {
      msgs.push({
        messageId: docSnap.id,
        ...(docSnap.data() as Omit<ChatMessage, 'messageId'>),
      });
    });

    const chronological = msgs.sort((a, b) => a.timestamp - b.timestamp);
    const nextOldestDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
    const hasMore = snapshot.docs.length >= pageSize;

    return {
      messages: chronological,
      oldestDocSnapshot: nextOldestDoc,
      hasMore,
    };
  } catch (err) {
    console.warn('Firestore fetch older chat messages notice:', err);
    return {
      messages: [],
      oldestDocSnapshot: null,
      hasMore: false,
    };
  }
}

export async function sendFirestoreMessage(
  chatId: string,
  message: Omit<ChatMessage, 'messageId'>
): Promise<string | null> {
  try {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const chatDocRef = doc(db, 'chats', chatId);

    const docRef = await addDoc(messagesRef, {
      ...message,
      timestamp: Date.now(),
    });

    await setDoc(
      chatDocRef,
      {
        chatId,
        participantIds: [message.senderId, message.receiverId],
        lastMessage: {
          messageId: docRef.id,
          ...message,
          timestamp: Date.now(),
        },
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    return docRef.id;
  } catch (err) {
    console.warn('Firestore send message notice:', err);
    return null;
  }
}

export async function markMessagesAsRead(chatId: string, receiverId: string): Promise<void> {
  try {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesRef, where('receiverId', '==', receiverId), where('status', '!=', 'READ'));
    const snapshot = await getDocs(q);

    snapshot.forEach(async (d) => {
      await updateDoc(d.ref, { status: 'READ' }).catch(() => {});
    });
  } catch (err) {
    console.warn('Firestore mark read notice:', err);
  }
}

// Real-time WebRTC Signaling in Firestore
export async function createCallSignalingSession(session: WebRtcCallSession): Promise<void> {
  try {
    const callRef = doc(db, 'calls', session.callId);
    await setDoc(callRef, {
      ...session,
      createdAt: Date.now(),
    });
  } catch (err) {
    console.warn('Firestore call signaling notice:', err);
  }
}

export async function saveOfferSDP(
  callId: string,
  offer: { type: string; sdp: string }
): Promise<void> {
  try {
    const callRef = doc(db, 'calls', callId);
    await updateDoc(callRef, {
      offer,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn('Firestore save offer SDP notice:', err);
  }
}

export async function saveAnswerSDP(
  callId: string,
  answer: { type: string; sdp: string },
  connectedAtTimestamp?: number
): Promise<number> {
  const connectedAt = connectedAtTimestamp || Date.now();
  try {
    const callRef = doc(db, 'calls', callId);
    await updateDoc(callRef, {
      answer,
      callState: 'CONNECTED',
      connectedAt,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn('Firestore save answer SDP notice:', err);
  }
  return connectedAt;
}

export async function addCallerCandidate(
  callId: string,
  candidate: RTCIceCandidateInit
): Promise<void> {
  try {
    const candidatesCol = collection(db, 'calls', callId, 'callerCandidates');
    await addDoc(candidatesCol, {
      ...candidate,
      createdAt: Date.now(),
    });
  } catch (err) {
    console.warn('Firestore add caller candidate notice:', err);
  }
}

export async function addReceiverCandidate(
  callId: string,
  candidate: RTCIceCandidateInit
): Promise<void> {
  try {
    const candidatesCol = collection(db, 'calls', callId, 'receiverCandidates');
    await addDoc(candidatesCol, {
      ...candidate,
      createdAt: Date.now(),
    });
  } catch (err) {
    console.warn('Firestore add receiver candidate notice:', err);
  }
}

export function subscribeToCallerCandidates(
  callId: string,
  onCandidate: (candidate: RTCIceCandidateInit) => void
) {
  const candidatesCol = collection(db, 'calls', callId, 'callerCandidates');
  return onSnapshot(
    candidatesCol,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          onCandidate(change.doc.data() as RTCIceCandidateInit);
        }
      });
    },
    (err) => {
      console.warn('Firestore caller candidates notice:', err);
    }
  );
}

export function subscribeToReceiverCandidates(
  callId: string,
  onCandidate: (candidate: RTCIceCandidateInit) => void
) {
  const candidatesCol = collection(db, 'calls', callId, 'receiverCandidates');
  return onSnapshot(
    candidatesCol,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          onCandidate(change.doc.data() as RTCIceCandidateInit);
        }
      });
    },
    (err) => {
      console.warn('Firestore receiver candidates notice:', err);
    }
  );
}

export function subscribeToIncomingCalls(
  userId: string,
  callback: (call: WebRtcCallSession | null) => void
) {
  const callsRef = collection(db, 'calls');
  const q = query(
    callsRef,
    where('receiverId', '==', userId),
    where('callState', 'in', ['CALLING', 'RINGING'])
  );

  return onSnapshot(
    q,
    (snapshot) => {
      if (!snapshot.empty) {
        const docSnap = snapshot.docs[0];
        callback(docSnap.data() as WebRtcCallSession);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn('Firestore incoming call notice:', err);
    }
  );
}

export function subscribeToActiveCallSession(
  callId: string,
  callback: (session: WebRtcCallSession | null) => void
) {
  const callRef = doc(db, 'calls', callId);
  return onSnapshot(
    callRef,
    (docSnap) => {
      if (docSnap.exists()) {
        callback(docSnap.data() as WebRtcCallSession);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn('Firestore active call notice:', err);
    }
  );
}

export async function updateCallStateInFirestore(
  callId: string,
  updates: Partial<WebRtcCallSession>
): Promise<void> {
  try {
    const callRef = doc(db, 'calls', callId);
    await updateDoc(callRef, {
      ...updates,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn('Firestore update call state notice:', err);
  }
}

// Call History Persistence
export async function saveCallRecordToFirestore(
  userId: string,
  record: CallRecord
): Promise<void> {
  try {
    const historyRef = collection(db, 'call_history', userId, 'records');
    await addDoc(historyRef, {
      ...record,
      createdAt: Date.now(),
    });
  } catch (err) {
    console.warn('Firestore save call record notice:', err);
  }
}

export function subscribeToCallHistory(
  userId: string,
  callback: (records: CallRecord[]) => void
) {
  const historyRef = collection(db, 'call_history', userId, 'records');
  const q = query(historyRef, orderBy('timestamp', 'desc'), limit(50));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: CallRecord[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as CallRecord);
      });
      callback(list);
    },
    (err) => {
      console.warn('Firestore call history notice:', err);
    }
  );
}
