"use client"

import { useEffect, useRef, useState } from "react"
import MosaicLogo from "@/components/mosaic/mosaic-logo"
import { Button } from "@/components/ui/button"
import { ArrowLeft, ChevronDown, ChevronUp, FileText, Mic, Moon } from "lucide-react"
import { cn } from "@/lib/utils"
import { getUserId, API_URL } from "@/lib/api"

// ─── Types ────────────────────────────────────────────────────────────────────
export type SignalType = "academic_context" | "sleep_data" | "voice_sample"
type TileStatus = "idle" | "uploading" | "done"

// ─── Signal config ────────────────────────────────────────────────────────────
const SIGNAL_CONFIG: Record<
  SignalType,
  {
    label: string
    description: string
    privacyStored: string
    privacyNever: string
    accept: string
    inputType: "file" | "record"
    confidenceDelta: number
    endpoint: string
    signalTypeParam: string
    maxBytes: number
    sizeLabel: string
  }
> = {
  academic_context: {
    label: "Academic context",
    description:
      "Upload a transcript or report card PDF — we'll pull out your GPA, course load, and grade trends.",
    privacyStored: "GPA, course load, grade trend summary.",
    privacyNever: "The file itself, full transcript text.",
    accept: ".pdf",
    inputType: "file",
    confidenceDelta: 20,
    endpoint: "/api/signals/transcript",
    signalTypeParam: "transcript",
    maxBytes: 10 * 1024 * 1024,
    sizeLabel: "10MB",
  },
  sleep_data: {
    label: "Sleep data",
    description:
      "Export sleep data from Apple Health or Google Fit as a CSV and upload it — we'll look at your average sleep and how consistent it is.",
    privacyStored: "Average sleep duration and night-to-night variability.",
    privacyNever: "Raw health export file, timestamps of individual nights.",
    accept: ".csv",
    inputType: "file",
    confidenceDelta: 20,
    endpoint: "/api/signals/sleep",
    signalTypeParam: "sleep",
    maxBytes: 5 * 1024 * 1024,
    sizeLabel: "5MB",
  },
  voice_sample: {
    label: "Voice sample",
    description:
      "Record a short voice memo — we'll analyze speech patterns like pace and tone, not what you say.",
    privacyStored: "Speech rate, pause patterns, pitch variation.",
    privacyNever: "The audio recording itself, a transcript of what you said.",
    accept: "audio/*",
    inputType: "record",
    confidenceDelta: 20,
    endpoint: "/api/signals/voice",
    signalTypeParam: "voice",
    maxBytes: 25 * 1024 * 1024,
    sizeLabel: "25MB",
  },
}

const SIGNAL_ORDER: SignalType[] = ["academic_context", "sleep_data", "voice_sample"]

// ─── Privacy explainer ────────────────────────────────────────────────────────
function PrivacyExplainer({ stored, never }: { stored: string; never: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[11px] text-muted-foreground leading-relaxed">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        Privacy
        {open
          ? <ChevronUp className="size-3" aria-hidden="true" />
          : <ChevronDown className="size-3" aria-hidden="true" />}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1 pl-0.5">
          <p>
            <span className="font-medium text-foreground/70">What&apos;s stored:</span> {stored}
          </p>
          <p>
            <span className="font-medium text-foreground/70">What&apos;s never stored:</span>{" "}
            {never}
          </p>
          <p>You can delete this anytime from your dashboard.</p>
        </div>
      )}
    </div>
  )
}

// ─── Recording control ────────────────────────────────────────────────────────
function RecordingControl({
  onUploading,
  onDone,
  onError,
}: {
  onUploading: () => void
  onDone: () => void
  onError: (msg: string) => void
}) {
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle")
  const [elapsed, setElapsed] = useState(0)
  const [voicePrompt, setVoicePrompt] = useState<{
    prompt: string
    duration_seconds: number
    tips: string[]
  } | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/api/signals/voice/prompt`)
      .then((r) => r.json())
      .then((j) => { if (j.success) setVoicePrompt(j.data) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (state === "recording") {
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [state])

  async function handleRecord() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        setState("uploading")
        onUploading()
        try {
          const userId = getUserId()
          const formData = new FormData()
          formData.append("file", blob, "recording.webm")
          formData.append("user_id", userId!)
          const res = await fetch(`${API_URL}/api/signals/voice`, {
            method: "POST",
            body: formData,
          })
          const json = await res.json()
          if (!json.success) {
            if (res.status === 409) throw new Error("Please complete your check-in first")
            throw new Error(json.error || "Upload failed")
          }
          onDone()
        } catch (err) {
          setState("idle")
          onError((err as Error).message || "Something went wrong — please try again.")
        }
      }

      recorder.start()
      setState("recording")
      setElapsed(0)

      const duration = voicePrompt?.duration_seconds ?? 60
      autoStopRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop()
      }, duration * 1000)
    } catch {
      onError("Microphone access is needed to record — check your browser permissions.")
    }
  }

  function handleStop() {
    if (autoStopRef.current) clearTimeout(autoStopRef.current)
    if (recorderRef.current?.state === "recording") recorderRef.current.stop()
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0")
  const ss = String(elapsed % 60).padStart(2, "0")

  return (
    <div className="flex flex-col gap-4">
      {voicePrompt && state === "idle" && (
        <div className="rounded-xl bg-secondary/50 px-4 py-3 flex flex-col gap-2">
          <p className="text-sm text-foreground leading-relaxed">{voicePrompt.prompt}</p>
          {voicePrompt.tips.length > 0 && (
            <ul className="flex flex-col gap-1">
              {voicePrompt.tips.map((tip, i) => (
                <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">
                  · {tip}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state === "idle" && (
        <Button
          size="sm"
          variant="outline"
          className="self-start rounded-full h-8 px-5 text-xs"
          onClick={handleRecord}
        >
          <Mic className="size-3 mr-1.5" aria-hidden="true" />
          Record
        </Button>
      )}

      {state === "recording" && (
        <div className="flex items-center gap-4">
          <div className="flex items-end gap-0.5 h-7" aria-label="Recording" role="img">
            {[4, 7, 5, 9, 6, 8, 4, 7, 5].map((h, i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-primary animate-pulse"
                style={{
                  height: `${h * 2.5}px`,
                  animationDelay: `${i * 80}ms`,
                  animationDuration: "900ms",
                }}
              />
            ))}
          </div>
          <span className="text-sm tabular-nums text-foreground font-medium">{mm}:{ss}</span>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full h-8 px-5 text-xs"
            onClick={handleStop}
          >
            Stop
          </Button>
        </div>
      )}

      {state === "uploading" && (
        <div className="flex items-center gap-2">
          <div className="size-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-xs text-muted-foreground">Analyzing your recording…</p>
        </div>
      )}
    </div>
  )
}

// ─── Signal tile ──────────────────────────────────────────────────────────────
function SignalTile({
  type,
  initialStatus,
}: {
  type: SignalType
  initialStatus: TileStatus
}) {
  const config = SIGNAL_CONFIG[type]
  const [status, setStatus] = useState<TileStatus>(initialStatus)
  const [fileName, setFileName] = useState<string | null>(null)
  const [tileError, setTileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setTileError(null)

    if (file.size > config.maxBytes) {
      setTileError(`File too large — max ${config.sizeLabel}`)
      e.target.value = ""
      return
    }

    setFileName(file.name)
    setStatus("uploading")

    try {
      const userId = getUserId()
      const formData = new FormData()
      formData.append("file", file)
      formData.append("user_id", userId!)
      const res = await fetch(`${API_URL}${config.endpoint}`, {
        method: "POST",
        body: formData,
      })
      const json = await res.json()
      if (!json.success) {
        if (res.status === 409) throw new Error("Please complete your check-in first")
        throw new Error(json.error || "Upload failed")
      }
      setStatus("done")
    } catch (err) {
      setStatus("idle")
      setFileName(null)
      setTileError((err as Error).message || "Something went wrong — please try again.")
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleRemove() {
    const userId = getUserId()
    try {
      await fetch(`${API_URL}/api/signals/${userId}/${config.signalTypeParam}`, {
        method: "DELETE",
      })
    } catch {
      // best-effort; tile resets regardless
    }
    setStatus("idle")
    setFileName(null)
    setTileError(null)
  }

  const Icon = type === "academic_context" ? FileText : type === "sleep_data" ? Moon : Mic

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-card border border-border/50 px-5 py-5">
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-xl bg-secondary flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="size-4 text-foreground/60" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">{config.label}</span>
          <span className="text-xs font-semibold text-primary">
            +{config.confidenceDelta} to your confidence score
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">{config.description}</p>
      <PrivacyExplainer stored={config.privacyStored} never={config.privacyNever} />

      {tileError && (
        <p className="text-xs leading-relaxed" style={{ color: "oklch(0.62 0.18 30)" }}>
          {tileError}
        </p>
      )}

      {status === "done" ? (
        <div className="flex flex-col gap-3 border-t border-border/40 pt-4">
          <div className="flex items-center gap-2">
            <div className="size-4 rounded-full bg-primary/20 flex items-center justify-center">
              <div className="size-2 rounded-full bg-primary" />
            </div>
            <p className="text-xs text-foreground font-medium">
              Got it — this will raise your confidence score.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setStatus("idle"); setFileName(null); setTileError(null) }}
              className="text-xs text-primary underline-offset-2 hover:underline self-start transition-colors"
            >
              Update
            </button>
            <button
              onClick={handleRemove}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline self-start transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      ) : status === "uploading" ? (
        <div className="flex items-center gap-2 pt-1">
          <div className="size-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-xs text-muted-foreground">
            Processing{fileName ? ` ${fileName}` : ""}…
          </p>
        </div>
      ) : config.inputType === "file" ? (
        <div className="border-t border-border/40 pt-4">
          <input
            ref={fileInputRef}
            type="file"
            accept={config.accept}
            onChange={handleFileChange}
            className="hidden"
            aria-label={`Upload ${config.label}`}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border",
              "py-5 cursor-pointer transition-colors hover:bg-secondary/40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <Icon className="size-5 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              Click to browse or drag &amp; drop
              <br />
              <span className="text-[10px] opacity-70">
                {config.accept.toUpperCase()} only · max {config.sizeLabel}
              </span>
            </p>
          </div>
        </div>
      ) : (
        <div className="border-t border-border/40 pt-4">
          <RecordingControl
            onUploading={() => setStatus("uploading")}
            onDone={() => setStatus("done")}
            onError={(msg) => { setStatus("idle"); setTileError(msg) }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Signals screen ───────────────────────────────────────────────────────────
export default function SignalsScreen({
  initialSignal,
  onBack,
}: {
  initialSignal?: SignalType
  onBack: () => void
}) {
  const [initialStatuses, setInitialStatuses] = useState<Record<SignalType, TileStatus>>({
    academic_context: "idle",
    sleep_data: "idle",
    voice_sample: "idle",
  })
  const [loadedInitial, setLoadedInitial] = useState(false)
  const refs = useRef<Partial<Record<SignalType, HTMLDivElement | null>>>({})

  useEffect(() => {
    const userId = getUserId()
    if (!userId) { setLoadedInitial(true); return }

    function applyBreakdown(breakdown: { source: string }[]) {
      const submitted = new Set(breakdown.map((b) => b.source))
      setInitialStatuses({
        academic_context: submitted.has("transcript") ? "done" : "idle",
        sleep_data:       submitted.has("sleep")      ? "done" : "idle",
        voice_sample:     submitted.has("voice")      ? "done" : "idle",
      })
    }

    // Read from the dashboard sessionStorage cache first — instant, no network call
    try {
      const cached = sessionStorage.getItem(`mosaic_dash_${userId}`)
      if (cached) {
        const { dash } = JSON.parse(cached)
        if (dash?.confidence?.breakdown) {
          applyBreakdown(dash.confidence.breakdown)
          setLoadedInitial(true)
          return // cache hit — skip the network fetch entirely
        }
      }
    } catch { /* ignore */ }

    // Cache miss — fetch the dashboard (first visit before dashboard has loaded)
    fetch(`${API_URL}/api/dashboard/${userId}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success && j.data?.confidence?.breakdown) {
          applyBreakdown(j.data.confidence.breakdown)
        }
      })
      .catch(() => {})
      .finally(() => setLoadedInitial(true))
  }, [])

  useEffect(() => {
    if (loadedInitial && initialSignal && refs.current[initialSignal]) {
      refs.current[initialSignal]?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [loadedInitial, initialSignal])

  return (
    <div className="min-h-screen w-full bg-background">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-24 -left-24 size-80 rounded-full bg-sage-light/50 blur-3xl" />
        <div className="absolute bottom-0 -right-32 size-96 rounded-full bg-sky-light/40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-lg px-5 py-10 flex flex-col gap-8">

        <header className="flex items-center justify-between">
          <MosaicLogo size="sm" />
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to dashboard
          </button>
        </header>

        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-3xl font-semibold italic text-foreground text-balance leading-snug">
            Add signals
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Each signal you add raises your confidence score and helps Mosaic give you more
            accurate recommendations.
          </p>
        </div>

        {!loadedInitial ? (
          <div className="flex justify-center py-10">
            <div className="size-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {SIGNAL_ORDER.map((type) => (
              <div key={type} ref={(el) => { refs.current[type] = el }}>
                <SignalTile type={type} initialStatus={initialStatuses[type]} />
              </div>
            ))}
          </div>
        )}

        <Button variant="outline" className="self-center rounded-full px-8" onClick={onBack}>
          Back to dashboard
        </Button>

      </div>
    </div>
  )
}
