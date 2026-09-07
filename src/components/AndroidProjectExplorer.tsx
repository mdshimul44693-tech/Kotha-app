import React, { useState } from 'react';
import { androidCodeFiles, AndroidCodeFile } from '../data/androidFiles';
import {
  FolderCode,
  FileText,
  Copy,
  Check,
  Download,
  Terminal,
  Layers,
  Shield,
  Smartphone,
  CheckCircle2,
} from 'lucide-react';

export const AndroidProjectExplorer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<AndroidCodeFile>(androidCodeFiles[1]);
  const [copied, setCopied] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'files' | 'architecture' | 'manual_test'>('files');

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <FolderCode className="w-5 h-5" />
            </span>
            <h3 className="text-lg font-bold text-white">
              Android Production Codebase & Architecture
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Production-ready Kotlin 2.0, Jetpack Compose, WebRTC, and Firebase integration.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 self-start">
          <button
            onClick={() => setSelectedTab('files')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              selectedTab === 'files'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Source Files
          </button>
          <button
            onClick={() => setSelectedTab('architecture')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              selectedTab === 'architecture'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Clean Architecture
          </button>
          <button
            onClick={() => setSelectedTab('manual_test')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              selectedTab === 'manual_test'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            2-Device Testing
          </button>
        </div>
      </div>

      {/* TAB 1: FILE EXPLORER & CODE VIEWER */}
      {selectedTab === 'files' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* File Tree List */}
          <div className="lg:col-span-4 bg-slate-950 border border-slate-800/80 rounded-2xl p-3 space-y-1 max-h-[520px] overflow-y-auto">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 block">
              Project Structure
            </span>

            {androidCodeFiles.map((file) => (
              <button
                key={file.path}
                onClick={() => setSelectedFile(file)}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center gap-2.5 transition cursor-pointer ${
                  selectedFile.path === file.path
                    ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-300 hover:bg-slate-900'
                }`}
              >
                <FileText className="w-4 h-4 shrink-0 text-slate-400" />
                <span className="truncate font-mono">{file.path}</span>
              </button>
            ))}
          </div>

          {/* Code Viewer */}
          <div className="lg:col-span-8 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
            <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-mono text-xs font-semibold text-emerald-400">
                  {selectedFile.path}
                </span>
                <p className="text-[11px] text-slate-400">{selectedFile.description}</p>
              </div>

              <button
                onClick={handleCopy}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>
            </div>

            <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[460px] leading-relaxed select-text">
              <code>{selectedFile.content}</code>
            </pre>
          </div>
        </div>
      )}

      {/* TAB 2: CLEAN ARCHITECTURE BLUEPRINT */}
      {selectedTab === 'architecture' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
              <Layers className="w-4 h-4" />
              <span>1. Presentation Layer</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Jetpack Compose declarative screens, Material3 design system, and stateful ViewModels
              holding immutable <code className="text-emerald-300">StateFlow&lt;UiState&gt;</code>.
            </p>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
              <li>ChatScreen & ChatViewModel</li>
              <li>CallScreen & WebRtcSessionManager</li>
              <li>ContactsScreen & Permission Handling</li>
              <li>LanguageSettings & LocaleHelper</li>
            </ul>
          </div>

          <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
            <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
              <Shield className="w-4 h-4" />
              <span>2. Domain Layer</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Pure business logic, domain models, and interactors with zero Android framework
              dependencies.
            </p>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
              <li>SendMessageUseCase</li>
              <li>InitiateWebRtcCallUseCase</li>
              <li>NormalizePhoneNumberUseCase</li>
              <li>SyncKothaContactsUseCase</li>
            </ul>
          </div>

          <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
              <Terminal className="w-4 h-4" />
              <span>3. Data Layer</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Firebase Firestore listeners, WebRTC native audio/video engine, Android Contact
              provider, and FCM background workers.
            </p>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
              <li>WebRtcClient (Camera2 & SurfaceView)</li>
              <li>FirestoreDataSource & Storage</li>
              <li>KothaFirebaseMessagingService</li>
              <li>AndroidAudioRecorder (AAC / M4A)</li>
            </ul>
          </div>
        </div>
      )}

      {/* TAB 3: PHYSICAL 2-DEVICE TESTING INSTRUCTIONS */}
      {selectedTab === 'manual_test' && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <Smartphone className="w-5 h-5" />
            <span>How to Test on Two Real Physical Android Devices</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2.5">
              <h5 className="font-bold text-white flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Step 1: Firebase Project Setup
              </h5>
              <ol className="space-y-1.5 text-slate-300 list-decimal list-inside leading-relaxed">
                <li>
                  Create a Firebase project at{' '}
                  <code className="text-emerald-300">console.firebase.google.com</code>.
                </li>
                <li>Add Android App with package name <code className="text-emerald-300">com.kotha.app</code>.</li>
                <li>Enable <strong>Phone Auth</strong>, <strong>Firestore</strong>, and <strong>Storage</strong>.</li>
                <li>Download <code className="text-emerald-300">google-services.json</code> into <code className="text-emerald-300">app/</code> directory.</li>
              </ol>
            </div>

            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2.5">
              <h5 className="font-bold text-white flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Step 2: Deployment & Verification
              </h5>
              <ol className="space-y-1.5 text-slate-300 list-decimal list-inside leading-relaxed">
                <li>Install APK on Device 1 (+88017...) and Device 2 (+88018...).</li>
                <li>Sign in via OTP and create user profiles.</li>
                <li>Grant Contacts permission on Device 1 to discover Device 2.</li>
                <li>Send text & voice notes; trigger WebRTC Audio & Video calls.</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
