"use client"

import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import MosaicLogo from "@/components/mosaic/mosaic-logo"
import { Button } from "@/components/ui/button"
import { EXERCISES } from "@/lib/exercises-data"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { getUserId, API_URL } from "@/lib/api"

async function completeExercise(exerciseId: string, completionData: Record<string, unknown>) {
  try {
    const userId = getUserId()
    const res = await fetch(`${API_URL}/api/exercises/${exerciseId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, completion_data: completionData }),
    })
    const json = await res.json()
    if (!json.success && res.status === 400 && json.error?.includes("10KB")) {
      console.warn("[mosaic] completion_data too large — backend rejected")
    }
  } catch {
    // best-effort; don't block the completion UI
  }
}

// ─── Pre-sleep review ──────────────────────────────────────────────────────────

const TOTAL_SECONDS = 12 * 60

function PreSleepReview({ exerciseId, onBack }: { exerciseId: string; onBack: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS)
  const [running, setRunning] = useState(false)
  const [notes, setNotes] = useState("")
  const [completed, setCompleted] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Tick
  useEffect(() => {
    if (running) {
      if (startedAtRef.current === null) {
        startedAtRef.current = TOTAL_SECONDS - secondsLeft
      }
      intervalRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            setRunning(false)
            setCompleted(true)
            return 0
          }
          return s - 1
        })
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [running])

  const handleReset = useCallback(() => {
    setRunning(false)
    setSecondsLeft(TOTAL_SECONDS)
    setCompleted(false)
    startedAtRef.current = null
  }, [])

  const handleDone = useCallback(() => {
    const elapsed = TOTAL_SECONDS - secondsLeft
    void completeExercise(exerciseId, { notes, duration_seconds: elapsed })
    onBack()
  }, [exerciseId, notes, secondsLeft, onBack])

  // Auto-expand textarea
  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }

  // Ring math
  const r = 52
  const circumference = 2 * Math.PI * r
  const progress = secondsLeft / TOTAL_SECONDS
  const offset = circumference * (1 - progress)

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0")
  const ss = String(secondsLeft % 60).padStart(2, "0")

  return (
    <div className="flex flex-col gap-8">
      {/* Intro */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        Spend 12 minutes passively reviewing today before you sleep. This replaces hours of
        late-night cramming with better retention.
      </p>

      {/* Timer */}
      <div className="flex flex-col items-center gap-6">
        {/* Ring */}
        <div className="relative flex items-center justify-center size-44">
          <svg
            className="-rotate-90"
            width="176"
            height="176"
            viewBox="0 0 176 176"
            aria-label={`${mm}:${ss} remaining`}
            role="img"
          >
            {/* Track */}
            <circle
              cx="88" cy="88" r={r}
              fill="none" stroke="currentColor" strokeWidth="8"
              className="text-border"
            />
            {/* Progress — stays sage the whole time */}
            <circle
              cx="88" cy="88" r={r}
              fill="none" stroke="currentColor" strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="text-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="font-heading text-4xl font-semibold tabular-nums text-foreground leading-none">
              {mm}:{ss}
            </span>
            <span className="text-[10px] text-muted-foreground tracking-wide">minutes</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            className="rounded-full px-6"
            onClick={() => setRunning((r) => !r)}
            disabled={completed}
          >
            {running ? "Pause" : secondsLeft === TOTAL_SECONDS ? "Start" : "Resume"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full px-5"
            onClick={handleReset}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="sleep-review-notes"
          className="text-xs font-medium text-muted-foreground"
        >
          Notes
        </label>
        <textarea
          id="sleep-review-notes"
          ref={textareaRef}
          value={notes}
          onChange={handleNotesChange}
          placeholder="What do you want to remember from today? Jot down anything that comes to mind..."
          rows={4}
          className={cn(
            "w-full resize-none overflow-hidden rounded-2xl bg-card border border-border/60",
            "px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60",
            "leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring",
            "transition-colors"
          )}
        />
      </div>

      {/* Completion message */}
      {completed && (
        <p className="text-sm text-muted-foreground text-center leading-relaxed">
          Nice work. Your notes are saved.
        </p>
      )}

      {/* Done — always available */}
      <Button
        className="self-center rounded-full px-8"
        onClick={handleDone}
      >
        Done
      </Button>
    </div>
  )
}

// ─── Brain dump ────────────────────────────────────────────────────────────────

function BrainDump({ exerciseId, onBack }: { exerciseId: string; onBack: () => void }) {
  const [content, setContent] = useState("")
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [timerStarted, setTimerStarted] = useState(false)
  const [completed, setCompleted] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Count up — starts on first keystroke, cleans up on unmount
  useEffect(() => {
    if (timerStarted && !completed) {
      intervalRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1)
      }, 1000)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [timerStarted, completed])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!timerStarted) setTimerStarted(true)
    setContent(e.target.value)
    // Auto-expand
    const el = e.target
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }

  const wordCount = content.trim() === "" ? 0 : content.trim().split(/\s+/).length

  const mm = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")
  const ss = String(elapsedSeconds % 60).padStart(2, "0")

  const handleDone = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setCompleted(true)
    void completeExercise(exerciseId, {
      content,
      duration_seconds: elapsedSeconds,
      word_count: wordCount,
    })
  }, [exerciseId, content, elapsedSeconds, wordCount])

  return (
    <div className="flex flex-col gap-6">
      {/* Intro */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        Write down every task, worry, and half-finished thought — anything taking up space in your
        head. Don&apos;t organize, don&apos;t edit, just empty it out.
      </p>

      {/* Textarea + elapsed timer */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          placeholder="Start typing whatever comes to mind..."
          rows={10}
          aria-label="Brain dump"
          className={cn(
            "w-full resize-none overflow-hidden rounded-2xl bg-card",
            "border border-border/50 px-5 py-4 pb-10",
            "text-sm text-foreground placeholder:text-muted-foreground/50",
            "leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring",
            "transition-colors min-h-[300px]"
          )}
        />
        {/* Elapsed timer — quiet, bottom-right corner of the textarea */}
        <span
          aria-live="off"
          className="absolute bottom-3 right-4 text-[11px] tabular-nums text-muted-foreground/60 select-none"
        >
          {mm}:{ss}
        </span>
      </div>

      {/* Word count */}
      <p className="text-xs text-muted-foreground -mt-3">
        {wordCount} {wordCount === 1 ? "word" : "words"}
      </p>

      {/* Completion state */}
      {completed ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Done. That&apos;s now out of your head and onto the page.
          </p>
          <Button
            variant="outline"
            className="rounded-full px-8"
            onClick={onBack}
          >
            Back to dashboard
          </Button>
        </div>
      ) : (
        <Button
          className="self-center rounded-full px-8"
          onClick={handleDone}
        >
          Done
        </Button>
      )}
    </div>
  )
}


// ─── Time boxing ──────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const HOURS = Array.from({ length: 17 }, (_, i) => i + 7) // 7am–11pm

// Cycle through 3 muted bg colors for visual variety
const SLOT_COLORS = [
  "bg-secondary text-secondary-foreground",
  "bg-sky-light text-accent-foreground",
  "bg-[oklch(0.93_0.06_80)] text-[oklch(0.38_0.08_75)]",
]

type SlotKey = `${number}-${number}` // `${dayIndex}-${hour}`
type SlotMap = Record<SlotKey, string>

function slotKey(day: number, hour: number): SlotKey {
  return `${day}-${hour}`
}

function TimeBoxing({ exerciseId, onBack }: { exerciseId: string; onBack: () => void }) {
  const [slots, setSlots] = useState<SlotMap>({})
  const [editing, setEditing] = useState<SlotKey | null>(null)
  const [draftText, setDraftText] = useState("")
  const [completed, setCompleted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing opens
  useEffect(() => {
    if (editing !== null) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [editing])

  const taskCount = Object.keys(slots).length

  // Assign a stable color per slot based on insertion order index
  const slotEntries = Object.keys(slots)
  function colorFor(key: SlotKey) {
    const idx = slotEntries.indexOf(key)
    return SLOT_COLORS[(idx < 0 ? slotEntries.length : idx) % SLOT_COLORS.length]
  }

  function openSlot(day: number, hour: number) {
    const key = slotKey(day, hour)
    setEditing(key)
    setDraftText(slots[key] ?? "")
  }

  function commitSlot() {
    if (editing === null) return
    if (draftText.trim()) {
      setSlots((prev) => ({ ...prev, [editing]: draftText.trim() }))
    } else {
      // Empty commit = clear
      setSlots((prev) => {
        const next = { ...prev }
        delete next[editing]
        return next
      })
    }
    setEditing(null)
    setDraftText("")
  }

  function clearSlot(key: SlotKey, e: React.MouseEvent) {
    e.stopPropagation()
    setSlots((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    if (editing === key) {
      setEditing(null)
      setDraftText("")
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitSlot()
    if (e.key === "Escape") { setEditing(null); setDraftText("") }
  }

  const handleDone = useCallback(() => {
    const schedule = Object.entries(slots).map(([key, taskName]) => {
      const [day, hour] = key.split("-").map(Number)
      return { day: DAYS[day], hour, taskName }
    })
    void completeExercise(exerciseId, { schedule, task_count: taskCount })
    setCompleted(true)
  }, [exerciseId, slots, taskCount])

  return (
    <div className="flex flex-col gap-6">
      {/* Intro */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        Give every task a fixed slot on your calendar instead of an open-ended list. This makes
        the workload feel finite and removes the guesswork of what to do next.
      </p>

      {/* Task count */}
      <p className="text-xs font-medium text-foreground">
        {taskCount} {taskCount === 1 ? "task" : "tasks"} scheduled this week
      </p>

      {/* Grid */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div
          className="grid gap-0"
          style={{ gridTemplateColumns: `3rem repeat(7, minmax(2.75rem, 1fr))` }}
        >
          {/* Day headers */}
          <div className="h-8" aria-hidden="true" />
          {DAYS.map((d) => (
            <div
              key={d}
              className="h-8 flex items-center justify-center text-[10px] font-semibold text-muted-foreground tracking-wide"
            >
              {d}
            </div>
          ))}

          {/* Hour rows */}
          {HOURS.map((hour) => (
            <Fragment key={hour}>
              {/* Hour label */}
              <div
                key={`label-${hour}`}
                className="h-10 flex items-center justify-end pr-2 text-[10px] text-muted-foreground/70 tabular-nums"
              >
                {hour % 12 === 0 ? 12 : hour % 12}
                {hour < 12 ? "a" : "p"}
              </div>

              {/* Day cells */}
              {DAYS.map((_, dayIdx) => {
                const key = slotKey(dayIdx, hour)
                const task = slots[key]
                const isEditing = editing === key

                return (
                  <div
                    key={key}
                    onClick={() => !isEditing && openSlot(dayIdx, hour)}
                    className={cn(
                      "h-10 border border-border/30 transition-colors cursor-pointer relative",
                      !task && !isEditing && "hover:bg-secondary/60",
                    )}
                  >
                    {isEditing ? (
                      <input
                        ref={inputRef}
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        onBlur={commitSlot}
                        onKeyDown={handleKeyDown}
                        placeholder="Task…"
                        className={cn(
                          "absolute inset-0 w-full h-full px-1.5 text-[10px]",
                          "bg-card border-2 border-primary/60 rounded-sm",
                          "text-foreground placeholder:text-muted-foreground/50",
                          "focus:outline-none z-10"
                        )}
                      />
                    ) : task ? (
                      <div
                        className={cn(
                          "absolute inset-0.5 rounded-sm flex items-center justify-between px-1 gap-0.5",
                          "group",
                          colorFor(key)
                        )}
                      >
                        <span className="text-[9px] font-medium leading-tight truncate">{task}</span>
                        <button
                          onClick={(e) => clearSlot(key, e)}
                          aria-label={`Remove ${task}`}
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 leading-none"
                        >
                          <span aria-hidden="true" className="text-[9px]">×</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground/60">
        Tap any cell to add a task. Tap an existing block to edit it.
      </p>

      {/* Completion */}
      {completed ? (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your week now has a shape. You can always come back and adjust it.
          </p>
          <Button variant="outline" className="rounded-full px-8" onClick={onBack}>
            Back to dashboard
          </Button>
        </div>
      ) : (
        <Button className="self-center rounded-full px-8" onClick={handleDone}>
          Done
        </Button>
      )}
    </div>
  )
}

// ─── Stress reappraisal ───────────────────────────────────────────────────────

const REAPPRAISAL_STEPS = 3

function StressReappraisal({ exerciseId, onBack }: { exerciseId: string; onBack: () => void }) {
  const [step, setStep] = useState(0) // 0 | 1 | 2
  const [animDir, setAnimDir] = useState<"in" | "out">("in")
  const [situation, setSituation] = useState("")
  const [reframe, setReframe] = useState("")
  const [completed, setCompleted] = useState(false)

  // Pre-fill the reframe prompt whenever situation changes and we're on step 1
  const reframeDefault = `I'm excited about ${situation.trim() || "…"}`

  function goTo(next: number) {
    setAnimDir("out")
    setTimeout(() => {
      setStep(next)
      setAnimDir("in")
      // Seed reframe input when arriving at step 1 for the first time
      if (next === 1 && reframe === "") {
        setReframe(reframeDefault)
      }
    }, 220)
  }

  // Keep reframe seeded if situation updates while still on step 0
  function handleSituationChange(val: string) {
    setSituation(val)
    if (reframe === "" || reframe.startsWith("I'm excited about ")) {
      setReframe(`I'm excited about ${val.trim() || "…"}`)
    }
  }

  const canContinue = step === 0 ? situation.trim().length > 0 : reframe.trim().length > 0

  function handleDone() {
    void completeExercise(exerciseId, { situation, reframe })
    setCompleted(true)
  }

  const inputClass = cn(
    "w-full rounded-2xl bg-card border border-border/60 px-4 py-3",
    "text-sm text-foreground placeholder:text-muted-foreground/50",
    "focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Step dots */}
      <div className="flex items-center justify-center gap-2" aria-label={`Step ${step + 1} of ${REAPPRAISAL_STEPS}`}>
        {Array.from({ length: REAPPRAISAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "rounded-full transition-all duration-300",
              i === step
                ? "size-2 bg-primary"
                : "size-1.5 bg-border"
            )}
          />
        ))}
      </div>

      {/* Animated step content */}
      <div
        key={step}
        className={cn(
          "flex flex-col gap-5",
          animDir === "in" ? "animate-fade-slide-in" : "animate-fade-slide-out"
        )}
      >
        {/* ── Step 0: Name it ── */}
        {step === 0 && (
          <>
            <div className="flex flex-col gap-1.5">
              <h2 className="font-heading text-lg font-medium italic text-foreground">
                Name it
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                What&apos;s making you feel anxious or stressed right now?
              </p>
            </div>
            <input
              type="text"
              value={situation}
              onChange={(e) => handleSituationChange(e.target.value)}
              placeholder="e.g. the bio exam on Friday"
              autoFocus
              className={inputClass}
              aria-label="Describe your situation"
            />
          </>
        )}

        {/* ── Step 1: The reframe ── */}
        {step === 1 && (
          <>
            <div className="flex flex-col gap-1.5">
              <h2 className="font-heading text-lg font-medium italic text-foreground">
                The reframe
              </h2>
            </div>

            {/* Explanation card */}
            <div className="rounded-2xl bg-secondary/60 px-5 py-4">
              <p className="text-sm text-foreground leading-relaxed">
                Anxiety and excitement share the exact same physiological signature — racing heart,
                alertness, energy. The only difference is the label your mind puts on it.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Try saying it differently. Instead of{" "}
                <span className="italic text-foreground">&ldquo;I&apos;m anxious about {situation}&rdquo;</span>,
                try completing this sentence:
              </p>
              <input
                type="text"
                value={reframe}
                onChange={(e) => setReframe(e.target.value)}
                autoFocus
                className={inputClass}
                aria-label="Complete the reframe sentence"
              />
            </div>
          </>
        )}

        {/* ── Step 2: Reflection ── */}
        {step === 2 && (
          <>
            <div className="flex flex-col gap-1.5">
              <h2 className="font-heading text-lg font-medium italic text-foreground">
                See the shift
              </h2>
            </div>

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 rounded-2xl bg-muted/70 px-4 py-4">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Before
                </span>
                <p className="text-sm text-foreground leading-relaxed">
                  I&apos;m anxious about {situation}
                </p>
              </div>
              <div className="flex flex-col gap-1.5 rounded-2xl bg-secondary/70 px-4 py-4">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-secondary-foreground/70">
                  After
                </span>
                <p className="text-sm text-foreground leading-relaxed">
                  {reframe}
                </p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Notice how that feels. The situation hasn&apos;t changed, but your relationship to it
              just shifted slightly.
            </p>

            {completed ? (
              <div className="flex flex-col items-center gap-4 pt-2 text-center">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  That&apos;s the practice. It gets easier with repetition.
                </p>
                <Button variant="outline" className="rounded-full px-8" onClick={onBack}>
                  Back to dashboard
                </Button>
              </div>
            ) : (
              <Button className="self-center rounded-full px-8" onClick={handleDone}>
                Done
              </Button>
            )}
          </>
        )}
      </div>

      {/* Navigation row — Back + Continue (not shown on step 2 after completion) */}
      {!(step === 2) && (
        <div className="flex items-center justify-between pt-2">
          {step > 0 ? (
            <button
              onClick={() => goTo(step - 1)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            className="rounded-full px-6"
            disabled={!canContinue}
            onClick={() => goTo(step + 1)}
          >
            Continue
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Process journaling ───────────────────────────────────────────────────────

type JournalEntry = {
  date: string
  went_well: string
  learned: string
  tomorrow: string
}

function formatEntryDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

const fieldClass =
  "w-full resize-none rounded-2xl bg-card border border-border/60 px-4 py-3 " +
  "text-sm text-foreground placeholder:text-muted-foreground/50 " +
  "leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring transition-colors"

function ProcessJournaling({ exerciseId, onBack }: { exerciseId: string; onBack: () => void }) {
  const [wentWell, setWentWell] = useState("")
  const [learned, setLearned] = useState("")
  const [tomorrow, setTomorrow] = useState("")
  const [saved, setSaved] = useState(false)
  const [history, setHistory] = useState<JournalEntry[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const canSave = wentWell.trim().length > 0 && learned.trim().length > 0 && tomorrow.trim().length > 0

  async function fetchHistory() {
    const userId = getUserId()
    if (!userId || !exerciseId) return
    try {
      const res = await fetch(
        `${API_URL}/api/exercises/history/${userId}?exercise_id=${exerciseId}&limit=20`
      )
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        setHistory(
          json.data.map((row: { completion_data: JournalEntry; completed_at: string }) => ({
            date: row.completed_at,
            went_well: row.completion_data?.went_well ?? "",
            learned:   row.completion_data?.learned   ?? "",
            tomorrow:  row.completion_data?.tomorrow   ?? "",
          }))
        )
      }
    } catch {
      // history load failure is non-blocking
    } finally {
      setHistoryLoaded(true)
    }
  }

  async function handleSave() {
    const entry: JournalEntry = {
      date: new Date().toISOString(),
      went_well: wentWell.trim(),
      learned: learned.trim(),
      tomorrow: tomorrow.trim(),
    }
    await completeExercise(exerciseId, { ...entry })
    setHistory((prev) => [entry, ...prev])
    setSaved(true)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Intro */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        A nightly process journal is one of the simplest high-leverage habits — brief, honest, and
        done. Keep each answer to a sentence or two.
      </p>

      {/* Form */}
      <div className="flex flex-col gap-5">
        {/* Field 1 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground" htmlFor="pj-went-well">
            What went well today?
          </label>
          <textarea
            id="pj-went-well"
            rows={2}
            value={wentWell}
            onChange={(e) => setWentWell(e.target.value)}
            placeholder="Keep it to a sentence or two."
            className={fieldClass}
            disabled={saved}
          />
        </div>

        {/* Field 2 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground" htmlFor="pj-learned">
            What didn&apos;t go as planned — and what&apos;s one thing you learned from it?
          </label>
          <textarea
            id="pj-learned"
            rows={2}
            value={learned}
            onChange={(e) => setLearned(e.target.value)}
            placeholder="One observation is enough."
            className={fieldClass}
            disabled={saved}
          />
        </div>

        {/* Field 3 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground" htmlFor="pj-tomorrow">
            One specific thing to do differently tomorrow
          </label>
          <textarea
            id="pj-tomorrow"
            rows={2}
            value={tomorrow}
            onChange={(e) => setTomorrow(e.target.value)}
            placeholder="Make it concrete and small."
            className={fieldClass}
            disabled={saved}
          />
        </div>
      </div>

      {/* Save / completion */}
      {saved ? (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground leading-relaxed text-center">
            Saved. Tomorrow&apos;s a fresh page.
          </p>

          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => {
                if (!historyLoaded) fetchHistory()
                setShowHistory((s) => !s)
              }}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline transition-colors"
              aria-expanded={showHistory}
            >
              {showHistory ? "Hide history" : "View history"}
            </button>

            <Button variant="outline" className="rounded-full px-8" onClick={onBack}>
              Back to dashboard
            </Button>
          </div>

          {/* History list */}
          {showHistory && (
            <div className="flex flex-col gap-4 mt-2">
              {history.map((entry, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-3 rounded-2xl bg-card border border-border/50 px-5 py-4"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {formatEntryDate(entry.date)}
                    {i === 0 && (
                      <span className="ml-2 text-primary normal-case tracking-normal font-normal">
                        — just now
                      </span>
                    )}
                  </span>
                  <div className="flex flex-col gap-2.5">
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Went well</p>
                      <p className="text-xs text-foreground leading-relaxed">{entry.went_well}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Learned</p>
                      <p className="text-xs text-foreground leading-relaxed">{entry.learned}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Tomorrow</p>
                      <p className="text-xs text-foreground leading-relaxed">{entry.tomorrow}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Button
          className="self-center rounded-full px-8"
          disabled={!canSave}
          onClick={handleSave}
        >
          Save entry
        </Button>
      )}
    </div>
  )
}

// ─── Exercise screen ───────────────────────────────────────────────────────────

export default function ExercisePage({
  slug,
  exerciseId,
  onBack,
}: {
  slug: string
  exerciseId: string
  onBack: () => void
}) {
  const exercise = EXERCISES.find((e) => e.slug === slug)

  if (!exercise) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
        <p className="text-muted-foreground text-sm">Exercise not found.</p>
        <Button variant="outline" size="sm" className="rounded-full" onClick={onBack}>
          Back to dashboard
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-background">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-24 -left-24 size-80 rounded-full bg-sage-light/50 blur-3xl" />
        <div className="absolute bottom-0 -right-32 size-96 rounded-full bg-sky-light/40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-lg px-5 py-10 flex flex-col gap-8">

        {/* Header */}
        <header className="flex items-center justify-between">
          <MosaicLogo size="sm" />
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back
          </button>
        </header>

        {/* Category chips */}
        <div className="flex flex-wrap gap-2">
          {exercise.categories.map((cat) => (
            <span
              key={cat}
              className="rounded-full bg-secondary text-secondary-foreground px-3 py-0.5 text-xs font-semibold tracking-wide"
            >
              {cat}
            </span>
          ))}
        </div>

        {/* Title */}
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl md:text-4xl font-semibold italic text-foreground text-balance leading-snug">
            {exercise.name}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {exercise.match_reason}
          </p>
        </div>

        {/* Exercise content — dispatched by slug */}
        {slug === "pre-sleep-review" ? (
          <PreSleepReview exerciseId={exerciseId} onBack={onBack} />
        ) : slug === "brain-dump" ? (
          <BrainDump exerciseId={exerciseId} onBack={onBack} />
        ) : slug === "time-boxing" ? (
          <TimeBoxing exerciseId={exerciseId} onBack={onBack} />
        ) : slug === "stress-reappraisal" ? (
          <StressReappraisal exerciseId={exerciseId} onBack={onBack} />
        ) : slug === "process-journaling" ? (
          <ProcessJournaling exerciseId={exerciseId} onBack={onBack} />
        ) : (
          <div className="rounded-2xl bg-card border border-border/50 px-6 py-8 flex flex-col gap-4 items-center text-center">
            <div className="size-12 rounded-full bg-secondary flex items-center justify-center">
              <div className="size-5 rounded-full bg-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
              The full guided experience for{" "}
              <span className="text-foreground font-medium">{exercise.name}</span> is being built
              next. This is the entry point — routing is wired and ready.
            </p>
          </div>
        )}

        {/* Counselor note */}
        {exercise.counselor_flag && (
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            If this keeps coming up, talking to a school counselor can help.
          </p>
        )}

      </div>
    </div>
  )
}
