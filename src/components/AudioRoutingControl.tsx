import React, { useState, useEffect } from 'react';
import {
  AudioOutputRoute,
  AudioRoutingTelemetry,
  Language,
} from '../types';
import { translations } from '../data/translations';
import { getDeviceAudioRouteManager } from '../lib/audioPipeline';
import {
  Headphones,
  Smartphone,
  Volume2,
  Bluetooth,
  BluetoothConnected,
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  Radio,
  ShieldCheck,
} from 'lucide-react';

interface AudioRoutingControlProps {
  userId: string;
  language: Language;
  isInCall: boolean;
  onRouteChanged?: (route: AudioOutputRoute) => void;
}

export const AudioRoutingControl: React.FC<AudioRoutingControlProps> = ({
  userId,
  language,
  isInCall,
  onRouteChanged,
}) => {
  const t = translations[language || 'en'];
  const audioManager = getDeviceAudioRouteManager(userId);

  const [telemetry, setTelemetry] = useState<AudioRoutingTelemetry>(audioManager.getTelemetry());
  const [isRouteSheetOpen, setIsRouteSheetOpen] = useState(false);
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);

  useEffect(() => {
    const unsub = audioManager.subscribeTelemetry((newTelemetry) => {
      setTelemetry(newTelemetry);
    });
    return () => unsub();
  }, [audioManager]);

  const handleSelectRoute = (route: AudioOutputRoute) => {
    audioManager.setRoute(route);
    onRouteChanged?.(route);
    setIsRouteSheetOpen(false);
  };

  const getRouteIcon = (route: AudioOutputRoute) => {
    switch (route) {
      case 'BLUETOOTH':
        return <Headphones className="w-4 h-4 text-sky-400" />;
      case 'SPEAKER':
        return <Volume2 className="w-4 h-4 text-emerald-400" />;
      case 'EARPIECE':
      default:
        return <Smartphone className="w-4 h-4 text-slate-300" />;
    }
  };

  const getRouteLabel = (route: AudioOutputRoute) => {
    switch (route) {
      case 'BLUETOOTH':
        return telemetry.bluetoothDeviceName
          ? `${t.audioRouteBluetooth} (${telemetry.bluetoothDeviceName})`
          : t.audioRouteBluetooth;
      case 'SPEAKER':
        return t.audioRouteSpeaker;
      case 'EARPIECE':
      default:
        return t.audioRouteEarpiece;
    }
  };

  return (
    <div className="w-full space-y-2">
      {/* Audio Status & Hardware Detection Bar */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-2.5 flex items-center justify-between gap-2 shadow-md">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-7 h-7 rounded-xl flex items-center justify-center transition ${
              telemetry.isRealBluetoothDetected
                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {telemetry.isRealBluetoothDetected ? (
              <BluetoothConnected className="w-4 h-4 animate-pulse" />
            ) : (
              <Bluetooth className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-200 truncate flex items-center gap-1.5">
              <span>
                {telemetry.isRealBluetoothDetected
                  ? telemetry.bluetoothDeviceName || 'Bluetooth Headset'
                  : 'No Bluetooth communication device'}
              </span>
              {telemetry.isRealBluetoothDetected && (
                <span className="text-[9px] px-1.5 py-0.2 bg-sky-500/20 text-sky-300 rounded border border-sky-500/30 font-mono">
                  Connected
                </span>
              )}
            </p>
            <p className="text-[9px] text-slate-400 font-mono">
              {telemetry.isRealBluetoothDetected
                ? 'Android Audio Device • Ready for VoIP'
                : 'Phone Earpiece & Loudspeaker ready'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Telemetry HUD Toggle */}
          <button
            onClick={() => setIsTelemetryOpen((prev) => !prev)}
            className={`p-1.5 rounded-lg border text-[10px] transition cursor-pointer flex items-center gap-1 ${
              isTelemetryOpen
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Android Audio Routing Diagnostics"
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="text-[10px] font-mono">Diag</span>
          </button>
        </div>
      </div>

      {/* Active In-Call Audio Route Selector (Standard Android Calling App) */}
      {isInCall && (
        <div className="relative">
          <button
            onClick={() => setIsRouteSheetOpen((prev) => !prev)}
            className="w-full bg-slate-900/95 border border-emerald-500/30 hover:border-emerald-500/60 rounded-xl px-3 py-2 flex items-center justify-between text-xs text-slate-200 transition shadow-lg cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-lg bg-slate-800">{getRouteIcon(telemetry.activeRoute)}</span>
              <div className="text-left">
                <span className="text-[10px] text-slate-400 block font-mono">
                  Audio Route ({telemetry.currentAudioMode})
                </span>
                <span className="text-xs font-bold text-white">
                  {getRouteLabel(telemetry.activeRoute)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-slate-400">
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-mono">
                {telemetry.remoteAudioPlaybackState}
              </span>
              {isRouteSheetOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {/* Android 12+ CommunicationDevice Selector Dropdown */}
          {isRouteSheetOpen && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-slate-950/98 border border-slate-800 rounded-2xl p-2 z-50 shadow-2xl backdrop-blur-md space-y-1 animate-scale-in">
              <div className="px-2 py-1 border-b border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>Select Communication Device</span>
                <span className="text-emerald-400">AudioManager API 35</span>
              </div>

              {/* Option 1: Bluetooth Headset */}
              <button
                disabled={!telemetry.isRealBluetoothDetected}
                onClick={() => handleSelectRoute('BLUETOOTH')}
                className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between text-xs transition cursor-pointer ${
                  telemetry.activeRoute === 'BLUETOOTH'
                    ? 'bg-sky-600/20 text-sky-300 border border-sky-500/30'
                    : telemetry.isRealBluetoothDetected
                    ? 'text-slate-200 hover:bg-slate-900'
                    : 'text-slate-500 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Headphones className="w-4 h-4 text-sky-400" />
                  <div>
                    <p className="font-semibold">
                      {telemetry.bluetoothDeviceName || t.audioRouteBluetooth}
                    </p>
                    <p className="text-[9px] text-slate-400 font-mono">
                      {telemetry.isRealBluetoothDetected
                        ? 'TYPE_BLE_HEADSET / SCO • Wireless Audio'
                        : 'No Bluetooth device connected in Android Settings'}
                    </p>
                  </div>
                </div>
                {telemetry.activeRoute === 'BLUETOOTH' && <Check className="w-4 h-4 text-sky-400" />}
              </button>

              {/* Option 2: Phone Earpiece */}
              <button
                onClick={() => handleSelectRoute('EARPIECE')}
                className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between text-xs transition cursor-pointer ${
                  telemetry.activeRoute === 'EARPIECE'
                    ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-200 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Smartphone className="w-4 h-4 text-emerald-400" />
                  <div>
                    <p className="font-semibold">{t.audioRouteEarpiece}</p>
                    <p className="text-[9px] text-slate-400 font-mono">TYPE_BUILTIN_EARPIECE (Receiver)</p>
                  </div>
                </div>
                {telemetry.activeRoute === 'EARPIECE' && <Check className="w-4 h-4 text-emerald-400" />}
              </button>

              {/* Option 3: Speakerphone */}
              <button
                onClick={() => handleSelectRoute('SPEAKER')}
                className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between text-xs transition cursor-pointer ${
                  telemetry.activeRoute === 'SPEAKER'
                    ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-200 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  <div>
                    <p className="font-semibold">{t.audioRouteSpeaker}</p>
                    <p className="text-[9px] text-slate-400 font-mono">TYPE_BUILTIN_SPEAKER (Loudspeaker)</p>
                  </div>
                </div>
                {telemetry.activeRoute === 'SPEAKER' && <Check className="w-4 h-4 text-emerald-400" />}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Diagnostics / Telemetry Panel */}
      {isTelemetryOpen && (
        <div className="bg-slate-950/95 border border-slate-800 rounded-2xl p-3 text-[10px] font-mono space-y-2 text-slate-300 shadow-xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 text-slate-400 font-semibold">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              Android Audio Diagnostics ({userId.toUpperCase()})
            </span>
            <span className="text-[9px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
              API 35
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800/60">
              <span className="text-slate-500 block text-[9px]">Audio Mode:</span>
              <span className="font-bold text-emerald-400">{telemetry.currentAudioMode}</span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800/60">
              <span className="text-slate-500 block text-[9px]">Audio Focus:</span>
              <span className="font-bold text-sky-400">{telemetry.audioFocusState}</span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800/60">
              <span className="text-slate-500 block text-[9px]">Active Route:</span>
              <span className="font-bold text-amber-400">{telemetry.activeRoute}</span>
            </div>
            <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800/60">
              <span className="text-slate-500 block text-[9px]">Bluetooth State:</span>
              <span
                className={`font-bold ${
                  telemetry.isRealBluetoothDetected ? 'text-sky-400' : 'text-slate-400'
                }`}
              >
                {telemetry.bluetoothConnectionState}
              </span>
            </div>
          </div>

          <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800/60 space-y-1">
            <span className="text-slate-500 block text-[9px]">Selected Communication Device:</span>
            <span className="font-semibold text-slate-200 block truncate">
              {telemetry.selectedDevice}
            </span>
          </div>

          <div className="bg-slate-900/80 p-2 rounded-xl border border-slate-800/60 space-y-1">
            <span className="text-slate-500 block text-[9px]">Available Communication Devices:</span>
            <div className="space-y-0.5 pt-0.5">
              {telemetry.availableDevices.map((dev, idx) => (
                <div key={idx} className="flex items-center gap-1 text-[9px] text-slate-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="truncate">{dev}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
