"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowRight } from "lucide-react"
import { AccountData } from "@/app/page"
import MosaicLogo from "@/components/mosaic/mosaic-logo"
import { apiFetch, setUserId } from "@/lib/api"

interface AccountCreationProps {
  onSubmit: (data: AccountData) => void
}

export default function AccountCreation({ onSubmit }: AccountCreationProps) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [apiError, setApiError] = useState<string | null>(null)

  function validate() {
    const errs: { name?: string; email?: string } = {}
    if (!name.trim()) errs.name = "Please enter your name."
    if (!email.trim()) errs.email = "Please enter your email."
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errs.email = "Please enter a valid email address."
    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    setErrors({})
    setApiError(null)
    setLoading(true)
    try {
      const data = await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({ email, name }),
      })
      setUserId(data.user_id)
      onSubmit({ name, email, userId: data.user_id, hasSurvey: !!data.has_survey })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong"
      const retryMatch = msg.match(/retry_after_seconds[:\s]+(\d+)/)
      setApiError(
        retryMatch
          ? `Too many attempts — please try again in ${retryMatch[1]}s.`
          : "Something went wrong — please try again."
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full px-6 py-16">
      <div className="w-full max-w-sm">
        <MosaicLogo className="mb-14" />

        <h2 className="font-heading text-3xl font-semibold italic text-foreground mb-2 text-balance leading-snug">
          Let&apos;s get you set up
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-9">
          We&apos;ll use this to personalize your dashboard and keep your insights safe.
        </p>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name" className="text-sm font-medium text-foreground">
              Your name
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="Alex Rivera"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              className="rounded-xl h-11 px-4 bg-card border-border focus-visible:ring-primary text-[0.95rem]"
              autoComplete="name"
              autoFocus
            />
            {errors.name && (
              <p className="text-destructive text-xs mt-0.5" role="alert">{errors.name}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-sm font-medium text-foreground">
              Email address
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="alex@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
              className="rounded-xl h-11 px-4 bg-card border-border focus-visible:ring-primary text-[0.95rem]"
              autoComplete="email"
            />
            {errors.email && (
              <p className="text-destructive text-xs mt-0.5" role="alert">{errors.email}</p>
            )}
          </div>

          {apiError && (
            <p className="text-destructive text-xs -mt-2" role="alert">{apiError}</p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={loading}
            className="rounded-full h-12 text-base font-medium mt-1 group"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                Setting up…
              </span>
            ) : (
              <>
                Continue
                <ArrowRight data-icon="inline-end" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </>
            )}
          </Button>
        </form>

        <p className="mt-7 text-center text-xs text-muted-foreground">
          We never share your data. Read our{" "}
          <span className="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors">
            privacy policy
          </span>
          .
        </p>
      </div>

      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -right-32 size-96 rounded-full bg-sky-light/40 blur-3xl" />
        <div className="absolute bottom-0 -left-20 size-72 rounded-full bg-sage-light/40 blur-3xl" />
      </div>
    </div>
  )
}
