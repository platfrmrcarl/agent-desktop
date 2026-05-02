import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useModelsStore } from '../../stores/modelsStore'
import { ProviderSection } from './tts/ProviderSection'
import { ResponseModeSection } from './tts/ResponseModeSection'
import { SummaryPromptSection } from './tts/SummaryPromptSection'
import type { DetectedPlayer } from './tts/ProviderSection'
import type { ValidationResult } from './tts/ResponseModeSection'

export function TTSSettings() {
  const { settings, setSetting } = useSettingsStore()

  const [players, setPlayers] = useState<DetectedPlayer[]>([])
  const [sayVoices, setSayVoices] = useState<{ name: string; locale: string }[]>([])
  const [validation, setValidation] = useState<ValidationResult | null>(null)

  const isMacOS = navigator.userAgent.includes("Macintosh")

  const provider = settings.tts_provider || ""
  const piperUrl = settings.tts_piperUrl || ""
  const edgettsVoice = settings.tts_edgettsVoice || ""
  const edgettsBinary = settings.tts_edgettsBinary || ""
  const sayVoice = settings.tts_sayVoice || ""
  const playerPath = settings.tts_playerPath || "auto"
  const maxLength = settings.tts_maxLength || "2000"
  const responseMode = settings.tts_responseMode || "off"
  const autoWordLimit = settings.tts_autoWordLimit || "200"
  const summaryPrompt = settings.tts_summaryPrompt || ""
  const summaryModel = settings.tts_summaryModel || ""

  const fetchedModels = useModelsStore((s) => s.models)
  const fetchModels = useModelsStore((s) => s.fetch)
  useEffect(() => { fetchModels() }, [fetchModels])

  useEffect(() => {
    window.agent.tts.detectPlayers().then(setPlayers).catch(() => {})
    if (isMacOS) {
      window.agent.tts.listSayVoices().then(setSayVoices).catch(() => {})
    }
  }, [])

  const handleProviderChange = useCallback((value: string) => {
    setSetting("tts_provider", value)
    setValidation(null)
  }, [setSetting])

  const handlePlayerPathChange = useCallback((value: string) => {
    setSetting("tts_playerPath", value)
    setValidation(null)
  }, [setSetting])

  return (
    <div className="flex flex-col gap-6">
      <ProviderSection
        provider={provider}
        piperUrl={piperUrl}
        edgettsVoice={edgettsVoice}
        edgettsBinary={edgettsBinary}
        sayVoice={sayVoice}
        sayVoices={sayVoices}
        playerPath={playerPath}
        players={players}
        isMacOS={isMacOS}
        onProviderChange={handleProviderChange}
        onPiperUrlChange={(v) => setSetting("tts_piperUrl", v)}
        onEdgettsVoiceChange={(v) => setSetting("tts_edgettsVoice", v)}
        onEdgettsBinaryChange={(v) => setSetting("tts_edgettsBinary", v)}
        onSayVoiceChange={(v) => setSetting("tts_sayVoice", v)}
        onPlayerPathChange={handlePlayerPathChange}
      />

      {provider && (
        <>
          <ResponseModeSection
            provider={provider}
            responseMode={responseMode}
            maxLength={maxLength}
            autoWordLimit={autoWordLimit}
            validation={validation}
            onResponseModeChange={(v) => setSetting("tts_responseMode", v)}
            onMaxLengthChange={(v) => setSetting("tts_maxLength", v)}
            onAutoWordLimitChange={(v) => setSetting("tts_autoWordLimit", v)}
            onValidationChange={setValidation}
          />

          <SummaryPromptSection
            responseMode={responseMode}
            summaryModel={summaryModel}
            summaryPrompt={summaryPrompt}
            fetchedModels={fetchedModels}
            onSummaryModelChange={(v) => setSetting("tts_summaryModel", v)}
            onSummaryPromptChange={(v) => setSetting("tts_summaryPrompt", v)}
          />
        </>
      )}
    </div>
  )
}
