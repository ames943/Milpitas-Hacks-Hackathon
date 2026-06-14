"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ArrowRight, ChevronLeft } from "lucide-react"
import MosaicLogo from "@/components/mosaic/mosaic-logo"
import { apiFetch, getUserId } from "@/lib/api"

// ─── Survey data ──────────────────────────────────────────────────────────────
// Questions 1–9  → "phq_answers"  (PHQ-9) when wired to the backend.
// Questions 10–16 → "gad_answers" (GAD-7) when wired to the backend.
// Index order must be preserved so scores map correctly.
// Answer values: Not at all=0, Several days=1, More than half the days=2, Nearly every day=3.

export const ANSWER_OPTIONS = [
  { label: "Not at all", value: 0 },
  { label: "Several days", value: 1 },
  { label: "More than half the days", value: 2 },
  { label: "Nearly every day", value: 3 },
]

export const SURVEY_QUESTIONS = [
  // PHQ-9 (indices 0–8 → phq_answers)
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
  "Feeling tired or having little energy",
  "Poor appetite or overeating",
  "Feeling bad about yourself, or that you're a failure",
  "Trouble concentrating on things like schoolwork or reading",
  "Moving or speaking slowly, or being unusually fidgety or restless",
  "Thoughts that you'd be better off not existing, or hurting yourself",
  // GAD-7 (indices 9–15 → gad_answers)
  "Feeling nervous, anxious, or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless it's hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid as if something awful might happen",
]

// ─── Crisis interstitial ──────────────────────────────────────────────────────

const CRISIS_RESOURCES = [
  {
    name: "988 Suicide & Crisis Lifeline",
    action: "Call or text 988",
    href: "tel:988",
  },
  {
    name: "Crisis Text Line",
    action: "Text HOME to 741741",
    href: "sms:741741?body=HOME",
  },
]

function CrisisInterstitial({
  onContinue,
  onDone,
}: {
  onContinue: () => void
  onDone: () => void
}) {
  return (
    <div className="flex flex-col min-h-screen w-full px-6 py-10">
      <div className="max-w-sm mx-auto w-full flex flex-col gap-10 flex-1 justify-center">

        {/* Acknowledgement */}
        <div className="flex flex-col gap-3">
          <p className="font-heading text-2xl md:text-3xl font-medium italic text-foreground leading-snug text-balance">
            Thanks for being honest about that.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            It matters more than anything else on this page. Please don&apos;t wait on this if
            you need to talk to someone now.
          </p>
        </div>

        {/* Resources */}
        <div className="flex flex-col gap-3">
          {CRISIS_RESOURCES.map((r) => (
            <a
              key={r.name}
              href={r.href}
              className={cn(
                "flex flex-col gap-0.5 rounded-2xl px-5 py-4",
                "bg-secondary border border-border/50",
                "hover:bg-secondary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <span className="text-sm font-semibold text-foreground">{r.name}</span>
              <span className="text-sm text-muted-foreground">{r.action}</span>
            </a>
          ))}
        </div>

        {/* Continuation copy */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          If you&apos;d like, you can continue with your check-in — your answers will still help
          build your picture.
        </p>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            className="rounded-full h-12 text-base font-medium w-full"
            onClick={onContinue}
          >
            Continue my check-in
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="rounded-full h-12 text-base font-medium w-full text-muted-foreground hover:text-foreground"
            onClick={onDone}
          >
            I&apos;m done for now
          </Button>
        </div>

      </div>

      {/* Background decoration */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-20 right-0 size-80 rounded-full bg-sky-light/40 blur-3xl" />
        <div className="absolute bottom-0 -left-20 size-80 rounded-full bg-sage-light/40 blur-3xl" />
      </div>
    </div>
  )
}

// ─── Done screen (when user exits from crisis interstitial) ───────────────────

function TakeCareScreen() {
  return (
    <div className="flex flex-col min-h-screen w-full px-6 py-10">
      <div className="max-w-sm mx-auto w-full flex flex-col gap-10 flex-1 justify-center">

        <div className="flex flex-col gap-3">
          <p className="font-heading text-2xl md:text-3xl font-medium italic text-foreground leading-snug text-balance">
            Take care of yourself.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You can always come back. The check-in will be here whenever you&apos;re ready.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {CRISIS_RESOURCES.map((r) => (
            <a
              key={r.name}
              href={r.href}
              className={cn(
                "flex flex-col gap-0.5 rounded-2xl px-5 py-4",
                "bg-secondary border border-border/50",
                "hover:bg-secondary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <span className="text-sm font-semibold text-foreground">{r.name}</span>
              <span className="text-sm text-muted-foreground">{r.action}</span>
            </a>
          ))}
        </div>

      </div>

      {/* Background decoration */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-20 right-0 size-80 rounded-full bg-sky-light/40 blur-3xl" />
        <div className="absolute bottom-0 -left-20 size-80 rounded-full bg-sage-light/40 blur-3xl" />
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface SurveyResults {
  name: string
  answers: (number | null)[]
  phqScore: number
  gadScore: number
  readinessScore: number
  flaggedQ9: boolean
  dimensionScores?: {
    id: string
    user_id: string
    cognitive_load: number
    emotional_regulation: number
    recovery_capacity: number
    confidence_score: number
    explanation_text: string
    created_at: string
  }
}

interface SurveyFlowProps {
  name: string
  onComplete: (results: SurveyResults) => void
}

export default function SurveyFlow({ name, onComplete }: SurveyFlowProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<(number | null)[]>(
    Array(SURVEY_QUESTIONS.length).fill(null)
  )
  const [selectedValue, setSelectedValue] = useState<number | null>(null)
  const [animState, setAnimState] = useState<"in" | "out">("in")
  const [screen, setScreen] = useState<"survey" | "crisis" | "done">("survey")
  const [pendingAnswers, setPendingAnswers] = useState<(number | null)[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Q9 is index 8 (0-based)
  const Q9_INDEX = 8

  const totalQuestions = SURVEY_QUESTIONS.length
  const progressPercent = Math.round(((currentIndex + 1) / totalQuestions) * 100)
  const isLast = currentIndex === totalQuestions - 1

  // Restore any previously saved answer when navigating back
  useEffect(() => {
    setSelectedValue(answers[currentIndex])
    setAnimState("in")
  }, [currentIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  async function complete(updated: (number | null)[], flaggedQ9: boolean) {
    const phq_answers = updated.slice(0, 9) as number[]
    const gad_answers = updated.slice(9, 16) as number[]

    const userId = getUserId()
    if (!userId) {
      console.error("[mosaic] no user_id found before survey submission")
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    let dimensionScores
    try {
      dimensionScores = await apiFetch("/api/survey", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, phq_answers, gad_answers }),
      })
    } catch (err) {
      console.error("[mosaic] survey submission failed", err)
      setSubmitting(false)
      setSubmitError("Something went wrong — please try again.")
      return
    }

    apiFetch(`/api/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ onboarding_complete: true }),
    }).catch((err) => console.warn("[mosaic] failed to set onboarding_complete", err))

    const phqScore = phq_answers.reduce((s, v) => s + v, 0)
    const gadScore = gad_answers.reduce((s, v) => s + v, 0)
    const total = updated.reduce<number>((s, v) => s + (v ?? 0), 0)
    const max = SURVEY_QUESTIONS.length * 3
    const readinessScore = Math.round((1 - total / max) * 100)

    onComplete({ name, answers: updated, phqScore, gadScore, readinessScore, flaggedQ9, dimensionScores })
  }

  function goToNext() {
    if (selectedValue === null) return

    const updated = [...answers]
    updated[currentIndex] = selectedValue
    setAnswers(updated)

    // Q9 interstitial check
    if (currentIndex === Q9_INDEX && selectedValue > 0) {
      setPendingAnswers(updated)
      setScreen("crisis")
      return
    }

    if (isLast) {
      void complete(updated, false)
      return
    }

    setAnimState("out")
    setTimeout(() => {
      setCurrentIndex((i) => i + 1)
    }, 240)
  }

  function goBack() {
    if (currentIndex === 0) return
    setAnimState("out")
    setTimeout(() => {
      setCurrentIndex((i) => i - 1)
    }, 240)
  }

  // ── Screen dispatch ──
  if (screen === "crisis") {
    return (
      <CrisisInterstitial
        onContinue={() => {
          setScreen("survey")
          setAnimState("out")
          setTimeout(() => setCurrentIndex(Q9_INDEX + 1), 240)
        }}
        onDone={() => setScreen("done")}
      />
    )
  }

  if (screen === "done") {
    return <TakeCareScreen />
  }

  return (
    <div className="flex flex-col min-h-screen w-full px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between max-w-sm mx-auto w-full mb-8">
        <MosaicLogo size="sm" />
        <span className="text-sm text-muted-foreground font-medium tabular-nums">
          {currentIndex + 1} / {totalQuestions}
        </span>
      </div>

      {/* Progress bar */}
      <div className="max-w-sm mx-auto w-full mb-12">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuenow={currentIndex}
            aria-valuemin={0}
            aria-valuemax={totalQuestions}
            aria-label={`Question ${currentIndex + 1} of ${totalQuestions}`}
          />
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 flex flex-col items-center justify-start w-full">
        <div
          key={currentIndex}
          className={cn(
            "w-full max-w-sm mx-auto",
            animState === "in" ? "animate-fade-slide-in" : "animate-fade-slide-out"
          )}
        >
          <h3 className="font-heading text-2xl md:text-3xl font-medium italic text-foreground leading-snug mb-10 text-balance">
            {SURVEY_QUESTIONS[currentIndex]}
          </h3>

          {/* Answer options — pill style, no hard box borders */}
          <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Answer options">
            {ANSWER_OPTIONS.map((option) => {
              const isSelected = selectedValue === option.value
              return (
                <button
                  key={option.value}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelectedValue(option.value)}
                  className={cn(
                    "w-full text-left px-5 py-3.5 rounded-2xl transition-all duration-150 cursor-pointer",
                    "text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/70 text-foreground hover:bg-secondary"
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex flex-col gap-3 mt-10 w-full max-w-sm mx-auto">
          {submitError && (
            <p className="text-destructive text-xs text-center" role="alert">{submitError}</p>
          )}
          <div className="flex items-center gap-3">
            {currentIndex > 0 && (
              <Button
                variant="ghost"
                size="lg"
                onClick={goBack}
                disabled={submitting}
                className="rounded-full h-12 px-5 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft data-icon="inline-start" />
                Back
              </Button>
            )}

            <Button
              size="lg"
              onClick={goToNext}
              disabled={selectedValue === null || submitting}
              className={cn(
                "rounded-full h-12 text-base font-medium group transition-all duration-200",
                currentIndex === 0 ? "w-full" : "flex-1"
              )}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                  Submitting…
                </span>
              ) : (
                <>
                  {isLast ? "See your results" : "Next"}
                  <ArrowRight
                    data-icon="inline-end"
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Background decoration */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-20 right-0 size-80 rounded-full bg-sky-light/40 blur-3xl" />
        <div className="absolute bottom-0 -left-20 size-80 rounded-full bg-sage-light/40 blur-3xl" />
      </div>
    </div>
  )
}
