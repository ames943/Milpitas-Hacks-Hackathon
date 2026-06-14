"use client"

import { useState } from "react"
import LandingScreen from "@/components/mosaic/landing-screen"
import AccountCreation from "@/components/mosaic/account-creation"
import ConfidenceExplainer from "@/components/mosaic/confidence-explainer"
import SurveyFlow from "@/components/mosaic/survey-flow"
import DashboardScreen from "@/components/mosaic/dashboard-screen"
import ExerciseScreen from "@/components/mosaic/exercise-screen"
import SignalsScreen, { type SignalType } from "@/components/mosaic/signals-screen"

export type OnboardingStep =
  | "landing"
  | "account"
  | "confidence"
  | "survey"
  | "dashboard"
  | "exercise"
  | "signals"

const LABEL_TO_SIGNAL: Record<string, SignalType> = {
  "Academic transcript": "academic_context",
  "Sleep data":          "sleep_data",
  "Voice sample":        "voice_sample",
}

export type AccountData = {
  name: string
  email: string
  userId?: string
  hasSurvey?: boolean
}

// Screens that should stay mounted once reached (never destroyed on nav)
const PERSISTENT: OnboardingStep[] = ["dashboard", "exercise", "signals"]

function show(active: OnboardingStep, target: OnboardingStep) {
  return active === target ? undefined : { display: "none" as const }
}

export default function HomePage() {
  const [step, setStep] = useState<OnboardingStep>("landing")
  const [accountData, setAccountData] = useState<AccountData>({ name: "", email: "" })
  const [activeExerciseSlug, setActiveExerciseSlug] = useState<string>("")
  const [activeExerciseId, setActiveExerciseId] = useState<string>("")
  const [activeSignal, setActiveSignal] = useState<SignalType | undefined>(undefined)
  const [dashRefreshKey, setDashRefreshKey] = useState(0)
  // Track which persistent screens have been mounted at least once
  const [mounted, setMounted] = useState<Set<OnboardingStep>>(new Set())

  function goTo(next: OnboardingStep) {
    if (PERSISTENT.includes(next)) {
      setMounted((prev) => new Set([...prev, next]))
    }
    setStep(next)
  }

  return (
    <main className="min-h-screen bg-background w-full">
      {/* Onboarding screens — conditionally rendered, no need to persist */}
      {step === "landing" && (
        <LandingScreen onGetStarted={() => goTo("account")} />
      )}
      {step === "account" && (
        <AccountCreation
          onSubmit={(data) => {
            setAccountData(data)
            goTo(data.hasSurvey ? "dashboard" : "confidence")
          }}
        />
      )}
      {step === "confidence" && (
        <ConfidenceExplainer
          name={accountData.name}
          onContinue={() => goTo("survey")}
          onSignOut={() => {
            localStorage.removeItem("mosaic_user_id")
            sessionStorage.clear()
            setMounted(new Set())
            setStep("landing")
          }}
        />
      )}
      {step === "survey" && (
        <SurveyFlow
          name={accountData.name}
          onComplete={() => { setDashRefreshKey((k) => k + 1); goTo("dashboard") }}
        />
      )}

      {/* Persistent screens — mounted once, hidden/shown with CSS */}
      {mounted.has("dashboard") && (
        <div style={show(step, "dashboard")}>
          <DashboardScreen
            refreshKey={dashRefreshKey}
            onStartExercise={(slug, exerciseId) => {
              setActiveExerciseSlug(slug)
              setActiveExerciseId(exerciseId)
              goTo("exercise")
            }}
            onSignalTap={(label) => {
              setActiveSignal(LABEL_TO_SIGNAL[label])
              goTo("signals")
            }}
            onNewCheckin={() => goTo("survey")}
            onSignOut={() => {
              localStorage.removeItem("mosaic_user_id")
              sessionStorage.clear()
              setMounted(new Set())
              setStep("landing")
            }}
          />
        </div>
      )}

      {mounted.has("exercise") && (
        <div style={show(step, "exercise")}>
          <ExerciseScreen
            slug={activeExerciseSlug}
            exerciseId={activeExerciseId}
            onBack={() => goTo("dashboard")}
          />
        </div>
      )}

      {mounted.has("signals") && (
        <div style={show(step, "signals")}>
          <SignalsScreen
            initialSignal={activeSignal}
            onBack={() => { setDashRefreshKey((k) => k + 1); goTo("dashboard") }}
          />
        </div>
      )}
    </main>
  )
}
