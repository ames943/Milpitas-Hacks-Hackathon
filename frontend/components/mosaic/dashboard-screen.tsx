"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import MosaicLogo from "@/components/mosaic/mosaic-logo"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiFetch, getUserId, API_URL } from "@/lib/api"

// ─── Types ────────────────────────────────────────────────────────────────────
type ExerciseCategory = "Cognitive" | "Structural" | "Physical" | "Social"
type APIColorBand = "green" | "amber" | "red"

type BreakdownEntry = { source: string; contribution: number; label: string }
type PotentialEntry = BreakdownEntry & { would_bring_total_to: number }

type DashDimension = { score: number; color: APIColorBand; explanation: string }

type DashData = {
  confidence: { total: number; breakdown: BreakdownEntry[]; potential: PotentialEntry[] }
  dimensions: {
    cognitive_load: DashDimension
    emotional_regulation: DashDimension
    recovery_capacity: DashDimension
  }
  disclaimer: string
}

type APIExercise = {
  id: string
  name: string
  categories: ExerciseCategory[]
  full_ui: boolean
  counselor_flag: boolean
}

type RecsData = {
  recommendations: { exercise: APIExercise; match_reason: string }[]
  counselor_nudge?: boolean
}

type TrendSnapshot = {
  cognitive_load: number
  emotional_regulation: number
  recovery_capacity: number
  created_at: string
}

type TrendData = {
  has_trend: boolean
  snapshot_count: number
  snapshots: TrendSnapshot[]
  trend: {
    cognitive_load: { direction: string; delta: number }
    emotional_regulation: { direction: string; delta: number }
    recovery_capacity: { direction: string; delta: number }
  } | null
}

// ─── Color helpers ────────────────────────────────────────────────────────────
const BAND_TO_COLOR: Record<APIColorBand, string> = {
  green: "oklch(0.6 0.1 155)",
  amber: "oklch(0.72 0.14 70)",
  red:   "oklch(0.62 0.18 30)",
}

function directionToColor(direction: string): string {
  if (direction === "improving") return "oklch(0.6 0.1 155)"
  if (direction === "worsening") return "oklch(0.62 0.18 30)"
  return "oklch(0.72 0.14 70)"
}

function weekLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.round(ms / 86_400_000)
  if (days < 1) return "Today"
  if (days < 7) return `${days}d`
  return `${Math.round(days / 7)}wk`
}

function nameToSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-")
}

// ─── Category pill styles ─────────────────────────────────────────────────────
const CATEGORY_STYLES: Record<ExerciseCategory, string> = {
  Cognitive:  "bg-sky-light text-accent-foreground",
  Structural: "bg-secondary text-secondary-foreground",
  Physical:   "bg-[oklch(0.93_0.06_80)] text-[oklch(0.38_0.08_75)]",
  Social:     "bg-[oklch(0.93_0.05_310)] text-[oklch(0.38_0.08_310)]",
}

// ─── Counselor nudge banner ───────────────────────────────────────────────────
function CounselorNudge({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="relative rounded-2xl bg-secondary/70 px-5 py-4 flex flex-col gap-2">
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
      <p className="text-sm text-foreground leading-relaxed pr-5">
        It looks like things have been harder lately. A school counselor could be a good person to
        talk to — want us to help you find one?
      </p>
      <a href="#" className="text-xs font-medium text-primary underline-offset-2 hover:underline self-start">
        Learn more
      </a>
    </div>
  )
}

// ─── Exercise card ────────────────────────────────────────────────────────────
function ExerciseCard({
  exercise,
  matchReason,
  initialSaved,
  onStart,
}: {
  exercise: APIExercise
  matchReason: string
  initialSaved: boolean
  onStart: (slug: string, id: string) => void
}) {
  const [saved, setSaved] = useState(initialSaved)
  const [saving, setSaving] = useState(false)

  async function toggleSave() {
    if (saving) return
    setSaving(true)
    const newSaved = !saved
    setSaved(newSaved) // optimistic
    try {
      const userId = getUserId()
      await fetch(`${API_URL}/api/exercises/${exercise.id}/save`, {
        method: newSaved ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      })
      // 409 on POST (already saved) and 404 on DELETE (not saved) are both success
    } catch {
      setSaved(!newSaved) // revert on network error
    } finally {
      setSaving(false)
    }
  }

  const slug = nameToSlug(exercise.name)

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-card px-5 py-4 border border-border/50">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-foreground leading-snug">{exercise.name}</span>
        <div className="flex flex-wrap gap-1 shrink-0">
          {exercise.categories.map((cat) => (
            <span
              key={cat}
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide",
                CATEGORY_STYLES[cat]
              )}
            >
              {cat}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{matchReason}</p>

      {exercise.counselor_flag && (
        <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/40 pt-2">
          If this keeps coming up, talking to a school counselor can help.
        </p>
      )}

      {exercise.full_ui ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start rounded-full h-8 px-4 text-xs"
          onClick={() => onStart(slug, exercise.id)}
        >
          Start
        </Button>
      ) : (
        <Button
          size="sm"
          variant={saved ? "secondary" : "outline"}
          className="self-start rounded-full h-8 px-4 text-xs"
          onClick={toggleSave}
          disabled={saving}
          aria-pressed={saved}
        >
          {saved ? "Saved" : "Save for later"}
        </Button>
      )}
    </div>
  )
}

// ─── Recommendations section ──────────────────────────────────────────────────
function RecommendationsSection({
  recs,
  counselorNudge,
  savedIds,
  onStart,
}: {
  recs: { exercise: APIExercise; match_reason: string }[]
  counselorNudge: boolean
  savedIds: Set<string>
  onStart: (slug: string, id: string) => void
}) {
  const [nudgeDismissed, setNudgeDismissed] = useState(false)

  return (
    <section aria-label="Recommended for you" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-heading text-lg font-medium italic text-foreground">
          Recommended for you
        </h2>
        <p className="text-xs text-muted-foreground">
          Based on your current patterns, these might help.
        </p>
      </div>

      {counselorNudge && !nudgeDismissed && (
        <CounselorNudge onDismiss={() => setNudgeDismissed(true)} />
      )}

      <div className="flex flex-col gap-3">
        {recs.map((r) => (
          <ExerciseCard
            key={r.exercise.id}
            exercise={r.exercise}
            matchReason={r.match_reason}
            initialSaved={savedIds.has(r.exercise.id)}
            onStart={onStart}
          />
        ))}
      </div>
    </section>
  )
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function SparklineChart({
  values,
  color,
  width = 220,
  height = 56,
}: {
  values: number[]
  color: string
  width?: number
  height?: number
}) {
  if (values.length < 2) return null

  const min = Math.min(...values) - 5
  const max = Math.max(...values) + 5
  const range = max - min || 1
  const stepX = width / (values.length - 1)
  const toY = (v: number) => height - ((v - min) / range) * height
  const points = values.map((v, i) => `${i * stepX},${toY(v)}`).join(" ")
  const areaPath =
    `M 0,${toY(values[0])} ` +
    values.map((v, i) => `L ${i * stepX},${toY(v)}`).join(" ") +
    ` L ${(values.length - 1) * stepX},${height} L 0,${height} Z`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      <path d={areaPath} fill={color} fillOpacity="0.08" />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={(values.length - 1) * stepX}
        cy={toY(values[values.length - 1])}
        r="3"
        fill={color}
      />
    </svg>
  )
}

// ─── Trend view ───────────────────────────────────────────────────────────────
type TrendDirection = "Improving" | "Stable" | "Worsening"

const TREND_LABEL_STYLES: Record<TrendDirection, string> = {
  Improving: "text-[oklch(0.52_0.1_155)]",
  Stable:    "text-muted-foreground",
  Worsening: "text-[oklch(0.58_0.14_50)]",
}

function apiDirToDisplay(d: string): TrendDirection {
  if (d === "improving") return "Improving"
  if (d === "worsening") return "Worsening"
  return "Stable"
}

const TREND_DIMS: {
  id: "cognitive_load" | "emotional_regulation" | "recovery_capacity"
  label: string
}[] = [
  { id: "cognitive_load",       label: "Cognitive Load" },
  { id: "emotional_regulation", label: "Emotional Regulation" },
  { id: "recovery_capacity",    label: "Recovery Capacity" },
]

function TrendView({
  snapshots,
  trend,
}: {
  snapshots: TrendSnapshot[]
  trend: TrendData["trend"]
}) {
  const labels = snapshots.map((s) => weekLabel(s.created_at))

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Here&apos;s how things have moved over the past few weeks.
      </p>

      {TREND_DIMS.map(({ id, label }) => {
        const values = snapshots.map((s) => s[id])
        const dirRaw = trend?.[id]?.direction ?? "stable"
        const direction = apiDirToDisplay(dirRaw)
        const color = directionToColor(dirRaw)
        const latest = values[values.length - 1]

        return (
          <div key={id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{label}</span>
              <span className={cn("text-xs font-medium", TREND_LABEL_STYLES[direction])}>
                {direction}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <SparklineChart values={values} color={color} />
              <div
                className="flex justify-between"
                style={{ width: 220 }}
                aria-hidden="true"
              >
                {labels.map((l, i) => (
                  <span key={i} className="text-[9px] text-muted-foreground/60 tabular-nums">
                    {l}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Latest:{" "}
              <span className="text-foreground font-medium tabular-nums">
                {Math.round(latest)}/100
              </span>
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ─── Tab switcher ─────────────────────────────────────────────────────────────
type DashTab = "snapshot" | "trend"

function TabSwitcher({
  active,
  onChange,
}: {
  active: DashTab
  onChange: (tab: DashTab) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      className="inline-flex rounded-full bg-muted p-1 gap-1 self-start"
    >
      {(["snapshot", "trend"] as DashTab[]).map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={active === tab}
          onClick={() => onChange(tab)}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-200 capitalize",
            active === tab
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab === "snapshot" ? "Snapshot" : "Your trend"}
        </button>
      ))}
    </div>
  )
}

// ─── Dimension bar ────────────────────────────────────────────────────────────
function DimensionBar({
  label,
  score,
  explanation,
  color,
}: {
  label: string
  score: number
  explanation: string
  color: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{score}/100</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${score}%`, backgroundColor: color }}
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{explanation}</p>
    </div>
  )
}

// ─── Confidence section ───────────────────────────────────────────────────────
function ConfidenceSection({
  score,
  signals,
  onSignalTap,
}: {
  score: number
  signals: Array<{ label: string; value: number; status: "submitted" | "potential" }>
  onSignalTap: (label: string) => void
}) {
  const r = 44
  const circumference = 2 * Math.PI * r
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-6">
        <div className="relative flex items-center justify-center size-28 shrink-0">
          <svg
            className="-rotate-90"
            width="112"
            height="112"
            viewBox="0 0 112 112"
            aria-hidden="true"
          >
            <circle
              cx="56" cy="56" r={r}
              fill="none" stroke="currentColor" strokeWidth="7"
              className="text-border"
            />
            <circle
              cx="56" cy="56" r={r}
              fill="none" stroke="currentColor" strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="text-primary transition-all duration-700 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-heading text-2xl font-semibold text-foreground tabular-nums leading-none">
              {score}%
            </span>
            <span className="text-[9px] text-muted-foreground mt-0.5 tracking-wide uppercase">
              confidence
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {signals.map((s) => {
            const isSubmitted = s.status === "submitted"
            return (
              <div
                key={s.label}
                role="button"
                tabIndex={0}
                aria-label={isSubmitted ? `Update ${s.label}` : `Add ${s.label}`}
                onClick={() => onSignalTap(s.label)}
                onKeyDown={(e) => e.key === "Enter" && onSignalTap(s.label)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs transition-colors cursor-pointer",
                  isSubmitted
                    ? "bg-secondary/60 hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    : "bg-muted/50 border border-dashed border-border hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                <span className={cn(
                  "font-medium truncate",
                  isSubmitted ? "text-foreground" : "text-muted-foreground"
                )}>
                  {s.label}
                </span>
                <span className={cn(
                  "shrink-0 font-semibold tabular-nums",
                  isSubmitted ? "text-primary" : "text-muted-foreground"
                )}>
                  {isSubmitted ? `+${s.value}` : (
                    <span className="flex items-center gap-0.5">
                      <Plus className="size-2.5" aria-hidden="true" />
                      {s.value} available
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function DashboardScreen({
  onStartExercise,
  onSignalTap,
  onNewCheckin,
  onSignOut,
  refreshKey = 0,
}: {
  onStartExercise: (slug: string, exerciseId: string) => void
  onSignalTap: (label: string) => void
  onNewCheckin: () => void
  onSignOut: () => void
  refreshKey?: number
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dashData, setDashData] = useState<DashData | null>(null)
  const [recsData, setRecsData] = useState<RecsData | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [firstName, setFirstName] = useState("there")
  const [activeTab, setActiveTab] = useState<DashTab>("snapshot")

  useEffect(() => {
    const userId = getUserId()
    if (!userId) {
      setError("No user session found.")
      setLoading(false)
      return
    }

    const cacheKey = `mosaic_dash_${userId}`
    const isForced = refreshKey > 0

    if (isForced) {
      // After a new check-in or signal upload — bust cache and show spinner
      try { sessionStorage.removeItem(cacheKey) } catch { /* ignore */ }
      setLoading(true)
    } else {
      // First mount — show cached data instantly while fetching fresh
      try {
        const cached = sessionStorage.getItem(cacheKey)
        if (cached) {
          const { dash, recs, trend, firstName: fn, savedIds: sids } = JSON.parse(cached)
          setDashData(dash)
          setRecsData(recs)
          if (trend) setTrendData(trend)
          if (fn) setFirstName(fn)
          if (sids) setSavedIds(new Set(sids))
          setLoading(false)
        }
      } catch { /* ignore bad cache */ }
    }

    Promise.all([
      apiFetch(`/api/dashboard/${userId}`).catch(() => null),
      apiFetch(`/api/exercises/recommended/${userId}`).catch(() => null),
      apiFetch(`/api/trend/${userId}`).catch(() => null),
      apiFetch(`/api/users/${userId}`).catch(() => null),
      apiFetch(`/api/exercises/saved/${userId}`).catch(() => []),
    ])
      .then(([dash, recs, trend, user, saved]) => {
        if (!dash) {
          setError("Couldn't load your dashboard — please try again.")
          return
        }
        const fn = user?.name ? ((user.name as string).split(" ")[0] || "there") : "there"
        const savedArr = ((saved as { exercise_id: string }[]) ?? []).map((s) => s.exercise_id)
        setDashData(dash as DashData)
        setRecsData(recs as RecsData | null)
        if (trend) setTrendData(trend as TrendData)
        setFirstName(fn)
        setSavedIds(new Set(savedArr))
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({
            dash, recs, trend, firstName: fn, savedIds: savedArr,
          }))
        } catch { /* storage full — ignore */ }
      })
      .catch((err: Error) => {
        setError(err.message || "Something went wrong — please try again.")
      })
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (error || !dashData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          {error || "Something went wrong — please try again."}
        </p>
      </div>
    )
  }

  const dimensions = [
    {
      id: "cognitive_load",
      label: "Cognitive Load",
      score: dashData.dimensions.cognitive_load.score,
      explanation: dashData.dimensions.cognitive_load.explanation,
      color: BAND_TO_COLOR[dashData.dimensions.cognitive_load.color],
    },
    {
      id: "emotional_regulation",
      label: "Emotional Regulation",
      score: dashData.dimensions.emotional_regulation.score,
      explanation: dashData.dimensions.emotional_regulation.explanation,
      color: BAND_TO_COLOR[dashData.dimensions.emotional_regulation.color],
    },
    {
      id: "recovery_capacity",
      label: "Recovery Capacity",
      score: dashData.dimensions.recovery_capacity.score,
      explanation: dashData.dimensions.recovery_capacity.explanation,
      color: BAND_TO_COLOR[dashData.dimensions.recovery_capacity.color],
    },
  ]

  const signals = [
    ...dashData.confidence.breakdown.map((b) => ({
      label: b.label,
      value: b.contribution,
      status: "submitted" as const,
    })),
    ...dashData.confidence.potential.map((p) => ({
      label: p.label,
      value: p.contribution,
      status: "potential" as const,
    })),
  ]

  const hasTrend = trendData?.has_trend ?? false

  return (
    <div className="min-h-screen w-full bg-background">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-24 -left-24 size-80 rounded-full bg-sage-light/50 blur-3xl" />
        <div className="absolute bottom-0 -right-32 size-96 rounded-full bg-sky-light/40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-lg px-5 py-10 flex flex-col gap-10">

        <header className="flex items-center justify-between">
          <MosaicLogo size="sm" />
          <p className="text-xs text-muted-foreground">Hi, {firstName}</p>
        </header>

        <div className="flex flex-col gap-2">
          <Button
            onClick={onSignOut}
            variant="outline"
            className="w-full rounded-2xl h-12 text-sm font-medium border-2 border-border hover:border-muted-foreground hover:bg-muted/40 transition-all text-muted-foreground"
          >
            Sign out
          </Button>
          <Button
            onClick={onNewCheckin}
            variant="outline"
            className="w-full rounded-2xl h-12 text-sm font-medium border-2 border-primary/30 hover:border-primary hover:bg-primary/5 transition-all"
          >
            New check-in
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-heading text-3xl md:text-4xl font-semibold italic text-foreground text-balance leading-snug">
              {activeTab === "trend" ? "Your trend" : "Your snapshot"}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {activeTab === "trend"
                ? "How your dimensions have moved over the past few weeks."
                : "Based on your most recent check-in. Updated each time you check in."}
            </p>
          </div>
          {hasTrend && <TabSwitcher active={activeTab} onChange={setActiveTab} />}
        </div>

        {activeTab === "snapshot" && (
          <>
            <section aria-label="Dimension scores" className="flex flex-col gap-6">
              {dimensions.map((d) => (
                <DimensionBar
                  key={d.id}
                  label={d.label}
                  score={d.score}
                  explanation={d.explanation}
                  color={d.color}
                />
              ))}
            </section>

            <div className="h-px bg-border" role="separator" />

            <section aria-label="Confidence score">
              <h2 className="font-heading text-lg font-medium italic text-foreground mb-4">
                Confidence score
              </h2>
              <ConfidenceSection
                score={dashData.confidence.total}
                signals={signals}
                onSignalTap={onSignalTap}
              />
            </section>

            <div className="h-px bg-border" role="separator" />

            {recsData ? (
              <RecommendationsSection
                recs={recsData.recommendations}
                counselorNudge={recsData.counselor_nudge ?? false}
                savedIds={savedIds}
                onStart={onStartExercise}
              />
            ) : (
              <section aria-label="Recommended for you" className="flex flex-col gap-4">
                <div className="flex flex-col gap-0.5">
                  <h2 className="font-heading text-lg font-medium italic text-foreground">
                    Recommended for you
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Recommendations are loading — check back in a moment.
                  </p>
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === "trend" && trendData && (
          <TrendView snapshots={trendData.snapshots} trend={trendData.trend} />
        )}

        <p className="text-[11px] text-muted-foreground text-center leading-relaxed pb-2">
          This is a reflection tool, not a diagnosis. If you&apos;re going through something
          difficult, talking to a counselor or trusted adult can help.
        </p>

      </div>
    </div>
  )
}
