import { inputStyle } from './shared'

export interface DetectedPlayer {
  name: string
  path: string
  available: boolean
}

interface ProviderSectionProps {
  provider: string
  piperUrl: string
  edgettsVoice: string
  edgettsBinary: string
  sayVoice: string
  sayVoices: { name: string; locale: string }[]
  playerPath: string
  players: DetectedPlayer[]
  isMacOS: boolean
  onProviderChange: (value: string) => void
  onPiperUrlChange: (value: string) => void
  onEdgettsVoiceChange: (value: string) => void
  onEdgettsBinaryChange: (value: string) => void
  onSayVoiceChange: (value: string) => void
  onPlayerPathChange: (value: string) => void
}

export function ProviderSection({
  provider,
  piperUrl,
  edgettsVoice,
  edgettsBinary,
  sayVoice,
  sayVoices,
  playerPath,
  players,
  isMacOS,
  onProviderChange,
  onPiperUrlChange,
  onEdgettsVoiceChange,
  onEdgettsBinaryChange,
  onSayVoiceChange,
  onPlayerPathChange,
}: ProviderSectionProps) {
  const showPlayerSelect = provider === 'piper' || provider === 'edgetts'
  const isPlayerCustom = playerPath !== 'auto' && !players.some((p) => p.path === playerPath)

  return (
    <>
      {/* Info */}
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {isMacOS ? (
          <>
            <span className="font-medium" style={{ color: 'var(--color-text)' }}>say</span> is the recommended option — built into macOS, no setup required.
            {' '}Also available: <span className="font-medium" style={{ color: 'var(--color-text)' }}>Piper</span> (local HTTP server) and{' '}
            <span className="font-medium" style={{ color: 'var(--color-text)' }}>EdgeTTS</span> (Microsoft Edge voices via CLI).
            Piper and EdgeTTS require an audio player (mpv or ffplay) to play generated audio files.
          </>
        ) : (
          <>
            Text-to-speech supports three providers:{' '}
            <span className="font-medium" style={{ color: 'var(--color-text)' }}>Piper</span> (local HTTP server),{' '}
            <span className="font-medium" style={{ color: 'var(--color-text)' }}>EdgeTTS</span> (Microsoft Edge voices via CLI), and{' '}
            <span className="font-medium" style={{ color: 'var(--color-text)' }}>spd-say</span> (speech-dispatcher, no extra setup).
            Piper and EdgeTTS require an audio player (aplay, paplay, ffplay, or mpv) to play generated audio files.
          </>
        )}
      </p>

      {/* Provider */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Provider
        </label>
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value)}
          className="w-full px-3 py-2 rounded text-sm outline-none mobile:text-base mobile:py-2"
          style={inputStyle}
          aria-label="TTS provider"
        >
          <option value="">Off</option>
          {isMacOS && <option value="say">say (macOS built-in)</option>}
          <option value="piper">Piper (HTTP)</option>
          <option value="edgetts">EdgeTTS</option>
          {!isMacOS && <option value="spd-say">spd-say</option>}
        </select>
      </div>

      {/* Piper: Server URL */}
      {provider === 'piper' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Server URL
          </label>
          <input
            type="text"
            value={piperUrl}
            onChange={(e) => onPiperUrlChange(e.target.value)}
            placeholder="http://localhost:5000"
            className="w-full px-3 py-2 rounded text-sm outline-none mobile:text-base"
            style={inputStyle}
            aria-label="Piper server URL"
          />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            URL of your running Piper TTS HTTP server
          </span>
        </div>
      )}

      {/* EdgeTTS: Voice + Binary */}
      {provider === 'edgetts' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Voice
            </label>
            <input
              type="text"
              value={edgettsVoice}
              onChange={(e) => onEdgettsVoiceChange(e.target.value)}
              placeholder="en-US-AriaNeural"
              className="w-full px-3 py-2 rounded text-sm outline-none mobile:text-base"
              style={inputStyle}
              aria-label="EdgeTTS voice"
            />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Microsoft Edge voice name (run <code>edge-tts --list-voices</code> to see available voices)
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Binary Path
            </label>
            <input
              type="text"
              value={edgettsBinary}
              onChange={(e) => onEdgettsBinaryChange(e.target.value)}
              placeholder="edge-tts"
              className="w-full px-3 py-2 rounded text-sm outline-none mobile:text-base"
              style={inputStyle}
              aria-label="EdgeTTS binary path"
            />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Full path or command name if it's in your PATH (e.g. edge-tts, /usr/bin/edge-tts)
            </span>
          </div>
        </>
      )}

      {/* say: voice picker */}
      {provider === 'say' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Voice <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}>(optional)</span>
          </label>
          <select
            value={sayVoice}
            onChange={(e) => onSayVoiceChange(e.target.value)}
            className="w-full px-3 py-2 rounded text-sm outline-none mobile:text-base"
            style={inputStyle}
            aria-label="say voice"
          >
            <option value="">System default</option>
            {sayVoices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.locale})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Audio Player (Piper & EdgeTTS only) */}
      {showPlayerSelect && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Audio Player
          </label>
          <select
            value={isPlayerCustom ? '__custom__' : playerPath}
            onChange={(e) => {
              const val = e.target.value
              onPlayerPathChange(val === '__custom__' ? '' : val)
            }}
            className="w-full px-3 py-2 rounded text-sm outline-none mobile:text-base"
            style={inputStyle}
            aria-label="Audio player"
          >
            <option value="auto">Auto-detect</option>
            {players
              .filter((p) => p.available)
              .map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name}
                </option>
              ))}
            <option value="__custom__">Custom</option>
          </select>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Audio player used to play generated speech files
          </span>
        </div>
      )}

      {/* Custom player path */}
      {showPlayerSelect && isPlayerCustom && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Player Path
          </label>
          <input
            type="text"
            value={playerPath === 'auto' ? '' : playerPath}
            onChange={(e) => onPlayerPathChange(e.target.value)}
            placeholder="/usr/bin/aplay"
            className="w-full px-3 py-2 rounded text-sm outline-none mobile:text-base"
            style={inputStyle}
            aria-label="Custom player path"
          />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Full path to audio player binary
          </span>
        </div>
      )}
    </>
  )
}
