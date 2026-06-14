"use client"

import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

interface LandingScreenProps {
  onGetStarted: () => void
}

export default function LandingScreen({ onGetStarted }: LandingScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full px-6 py-20 text-center">

      {/* Wordmark */}
      <div className="mb-12 flex items-center gap-2">
        <div className="grid grid-cols-2 gap-[3px] size-5">
          <div className="rounded-[2px] bg-primary" />
          <div className="rounded-[2px] bg-primary/40" />
          <div className="rounded-[2px] bg-primary/40" />
          <div className="rounded-[2px] bg-primary" />
        </div>
        <span className="font-heading text-xl font-semibold tracking-tight text-foreground">mosaic</span>
      </div>

      {/* Eyebrow */}
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-6">
        for high-achieving students
      </p>

      {/* Headline — handwritten-feel via italic serif */}
      <h1 className="font-heading text-5xl md:text-6xl font-semibold italic text-foreground leading-tight tracking-tight text-balance max-w-2xl mb-5">
        Understand what&apos;s actually driving your output.
      </h1>

      {/* Body */}
      <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-md mb-12 text-balance">
        Mosaic builds a personalized picture of how you work best — so you can spend your energy where it counts.
      </p>

      <div className="flex justify-center w-full">
        <Button
          size="lg"
          onClick={onGetStarted}
          className="rounded-full px-8 h-12 text-base font-medium"
        >
          Get started
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Takes about 5 minutes &nbsp;·&nbsp; Your data stays private
      </p>

      {/* Ambient warmth — very faint */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -left-40 size-[600px] rounded-full bg-sage-light/50 blur-3xl" />
        <div className="absolute top-1/2 -right-56 size-[500px] rounded-full bg-sky-light/35 blur-3xl" />
        <div className="absolute -bottom-32 left-1/4 size-96 rounded-full bg-sage-light/30 blur-3xl" />
      </div>
    </div>
  )
}
