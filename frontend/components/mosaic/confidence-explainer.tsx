"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ArrowRight, BookOpen, Moon, Mic, ClipboardList, Check } from "lucide-react"
import MosaicLogo from "@/components/mosaic/mosaic-logo"
import { cn } from "@/lib/utils"

interface ConfidenceExplainerProps {
  name: string
  onContinue: () => void
  onSignOut: () => void
}

const SCORE_SEGMENTS = [
  {
    label: "Quick check-in",
    description: "Your daily patterns and energy levels",
    icon: ClipboardList,
  },
  {
    label: "Academic context",
    description: "How you approach goals and workload",
    icon: BookOpen,
  },
  {
    label: "Sleep patterns",
    description: "Rest quality and recovery habits",
    icon: Moon,
  },
  {
    label: "Voice sample",
    description: "Optional vocal biomarkers for deeper insight",
    icon: Mic,
  },
]

function ConfidenceRing({ percent }: { percent: number }) {
  const r = 52
  const circumference = 2 * Math.PI * r
  const offset = circumference - (percent / 100) * circumference

  return (
    <div className="relative flex items-center justify-center size-44">
      <svg
        className="-rotate-90"
        width="176"
        height="176"
        viewBox="0 0 176 176"
        aria-label={`Confidence score: ${percent}%`}
        role="img"
      >
        {/* Track */}
        <circle
          cx="88"
          cy="88"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-border"
        />
        {/* Progress */}
        <circle
          cx="88"
          cy="88"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-primary transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-4xl font-semibold text-foreground leading-none tabular-nums">
          {percent}%
        </span>
        <span className="text-xs text-muted-foreground mt-1 tracking-wide">confidence</span>
      </div>
    </div>
  )
}

export default function ConfidenceExplainer({ name, onContinue, onSignOut }: ConfidenceExplainerProps) {
  const firstName = name.split(" ")[0] || "there"
  // Track which segments have been "revealed" by hovering/clicking
  const [revealed, setRevealed] = useState<boolean[]>([false, false, false, false])

  const score = revealed.filter(Boolean).length * 25

  function toggleReveal(i: number) {
    setRevealed((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      return next
    })
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full px-6 py-16">
      <div className="w-full max-w-md">
        <MosaicLogo className="mb-12" />

        <h2 className="font-heading text-3xl md:text-[2.1rem] font-semibold text-foreground mb-3 leading-snug text-balance">
          Hey {firstName}, here&apos;s how your confidence score works
        </h2>
        <p className="text-muted-foreground text-[0.95rem] leading-relaxed mb-10 text-balance">
          Tap each piece to see what it adds. The more you share, the clearer your picture gets.
        </p>

        {/* Ring — centered above the list */}
        <div className="flex justify-center mb-10">
          <div className="flex flex-col items-center gap-2">
            <ConfidenceRing percent={score} />
            <p className="text-xs text-muted-foreground">
              {score === 0
                ? "Tap a row to see it build"
                : score === 100
                ? "Full picture unlocked"
                : `${100 - score}% still to go`}
            </p>
          </div>
        </div>

        {/* Segments — no card borders, just rows */}
        <div className="flex flex-col divide-y divide-border/50 mb-10">
          {SCORE_SEGMENTS.map((seg, i) => {
            const Icon = seg.icon
            const active = revealed[i]
            return (
              <button
                key={seg.label}
                onClick={() => toggleReveal(i)}
                className={cn(
                  "flex items-center gap-4 py-4 text-left w-full group transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg px-1",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {/* Icon dot */}
                <div
                  className={cn(
                    "shrink-0 size-9 rounded-full flex items-center justify-center transition-colors duration-300",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:bg-secondary"
                  )}
                >
                  {active ? <Check className="size-4" /> : <Icon className="size-4" />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-medium transition-colors duration-150", active ? "text-foreground" : "")}>
                    {seg.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {seg.description}
                  </p>
                </div>

                <span
                  className={cn(
                    "text-sm font-semibold shrink-0 tabular-nums transition-all duration-300",
                    active ? "text-primary opacity-100" : "opacity-0 translate-x-1"
                  )}
                >
                  +25%
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onSignOut}
            className="w-full rounded-full h-12 text-base font-medium border-2 border-border text-muted-foreground hover:border-muted-foreground hover:bg-muted/40 transition-all"
          >
            Sign out
          </Button>

          <Button
            size="lg"
            onClick={onContinue}
            className="w-full rounded-full h-12 text-base font-medium group"
          >
            Start my check-in
            <ArrowRight
              data-icon="inline-end"
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          You can skip any question you&apos;re not comfortable with.
        </p>
      </div>

      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/4 -left-40 size-96 rounded-full bg-sage-light/40 blur-3xl" />
        <div className="absolute -bottom-16 right-0 size-80 rounded-full bg-sky-light/30 blur-3xl" />
      </div>
    </div>
  )
}
