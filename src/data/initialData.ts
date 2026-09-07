import { UserProfile, DeviceContact, DirectChat, CallRecord, ChatMessage } from '../types';

export const initialUserA: UserProfile = {
  userId: 'user_tahmid_dhaka',
  phoneNumber: '+8801712345678',
  fullName: 'Tahmid Rahman (তাহমিদ)',
  profilePhotoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
  about: 'Software Architect | Focusing on Kotlin & WebRTC',
  isOnline: true,
  lastSeen: Date.now(),
  fcmToken: 'fcm_token_device_a_dhaka_kotha_88017',
  lowDataMode: false,
  preferredLanguage: 'bn',
};

export const initialUserB: UserProfile = {
  userId: 'user_nabila_ctg',
  phoneNumber: '+8801898765432',
  fullName: 'Nabila Islam (নাবিলা)',
  profilePhotoUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80',
  about: 'Designing experiences & enjoying tea 🍵',
  isOnline: true,
  lastSeen: Date.now() - 120000,
  fcmToken: 'fcm_token_device_b_ctg_kotha_88018',
  lowDataMode: true,
  preferredLanguage: 'bn',
};

export const initialDeviceContactsForA: DeviceContact[] = [
  {
    id: 'c1',
    displayName: 'Nabila Islam (নাবিলা)',
    phoneNumber: '+8801898765432',
    isKothaUser: true,
    kothaUserId: 'user_nabila_ctg',
    kothaProfilePhoto: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80',
    about: 'Designing experiences & enjoying tea 🍵',
  },
  {
    id: 'c2',
    displayName: 'Rafiqul Hassan (রফিক)',
    phoneNumber: '+8801755123456',
    isKothaUser: true,
    kothaUserId: 'user_rafiq',
    kothaProfilePhoto: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
    about: 'Available on Kotha',
  },
  {
    id: 'c3',
    displayName: 'Sumiya Akter (সুমাইয়া)',
    phoneNumber: '+8801611223344',
    isKothaUser: true,
    kothaUserId: 'user_sumiya',
    kothaProfilePhoto: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&auto=format&fit=crop&q=80',
    about: 'Busy with work',
  },
  {
    id: 'c4',
    displayName: 'Uncle Kamal (কামাল মামা)',
    phoneNumber: '+8801911998877',
    isKothaUser: false,
  },
];

export const initialMessages: ChatMessage[] = [
  {
    messageId: 'msg_init_01',
    senderId: 'user_nabila_ctg',
    receiverId: 'user_tahmid_dhaka',
    text: 'আসসালামু আলাইকুম তাহমিদ ভাই! কেমন আছেন?',
    type: 'TEXT',
    timestamp: Date.now() - 3600000 * 2,
    status: 'READ',
  },
  {
    messageId: 'msg_init_02',
    senderId: 'user_tahmid_dhaka',
    receiverId: 'user_nabila_ctg',
    text: 'ওয়ালাইকুম আসসালাম নাবিলা! আলহামদুলিল্লাহ ভালো। কথা (Kotha) অ্যাপের নতুন WebRTC কলিং টেস্ট করছিলেন?',
    type: 'TEXT',
    timestamp: Date.now() - 3600000 * 1.5,
    status: 'READ',
  },
  {
    messageId: 'msg_init_03',
    senderId: 'user_nabila_ctg',
    receiverId: 'user_tahmid_dhaka',
    text: 'হ্যাঁ! অডিও কোয়ালিটি অনেক স্পষ্ট এবং লেটেন্সি একদম কম।',
    type: 'TEXT',
    timestamp: Date.now() - 3600000,
    status: 'READ',
  },
];

export const initialCallHistory: CallRecord[] = [
  {
    callId: 'call_rec_01',
    peerId: 'user_nabila_ctg',
    peerName: 'Nabila Islam (নাবিলা)',
    peerPhotoUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80',
    peerPhone: '+8801898765432',
    callType: 'VIDEO',
    direction: 'INCOMING',
    status: 'ANSWERED',
    timestamp: Date.now() - 86400000,
    durationSeconds: 245,
  },
  {
    callId: 'call_rec_02',
    peerId: 'user_rafiq',
    peerName: 'Rafiqul Hassan (রফিক)',
    peerPhotoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
    peerPhone: '+8801755123456',
    callType: 'AUDIO',
    direction: 'OUTGOING',
    status: 'ANSWERED',
    timestamp: Date.now() - 172800000,
    durationSeconds: 112,
  },
];
