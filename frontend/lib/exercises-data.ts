// ─── Exercise catalogue ────────────────────────────────────────────────────────
// Each entry maps to a full-UI exercise screen (full_ui: true) or a future
// lightweight card (full_ui: false). counselor_flag surfaces a soft secondary
// line encouraging the student to speak with a school counselor if the pattern
// keeps showing up.

export type ExerciseCategory = "Cognitive" | "Structural" | "Physical" | "Social"

export interface Exercise {
  slug: string
  name: string
  categories: ExerciseCategory[]
  match_reason: string
  counselor_flag: boolean
  full_ui: boolean
}

export const EXERCISES: Exercise[] = [
  {
    slug: "pre-sleep-review",
    name: "Pre-sleep review",
    categories: ["Cognitive", "Structural"],
    match_reason:
      "Your recovery capacity has been trending down — spending 5 minutes reviewing tomorrow before bed can quiet the background hum that makes it hard to switch off.",
    counselor_flag: false,
    full_ui: true,
  },
  {
    slug: "brain-dump",
    name: "Brain dump",
    categories: ["Cognitive", "Structural"],
    match_reason:
      "When concentration is scattered, getting everything out of your head and onto paper reduces the mental overhead of holding it all at once.",
    counselor_flag: false,
    full_ui: true,
  },
  {
    slug: "time-boxing",
    name: "Time boxing",
    categories: ["Structural"],
    match_reason:
      "Assigning fixed time slots to tasks removes the low-level anxiety of deciding what to work on next, which frees up more energy for the actual work.",
    counselor_flag: false,
    full_ui: true,
  },
  {
    slug: "stress-reappraisal",
    name: "Stress reappraisal",
    categories: ["Cognitive"],
    match_reason:
      "Your check-in suggests you're carrying some emotional weight. Reframing stress as a signal rather than a threat is a small shift that can meaningfully change how you move through hard days.",
    counselor_flag: false,
    full_ui: true,
  },
  {
    slug: "process-journaling",
    name: "Process journaling",
    categories: ["Cognitive", "Social"],
    match_reason:
      "Your recovery capacity has been trending down — a quick nightly reflection can help interrupt the spiral before it builds.",
    counselor_flag: true,
    full_ui: true,
  },
  // ── full_ui: false exercises ───────────────────────────────────────────────
  {
    slug: "hard-shutdown-ritual",
    name: "Hard shutdown ritual",
    categories: ["Structural", "Physical"],
    match_reason:
      "Ending the day with a fixed sequence — closing tabs, writing a done list, stepping away from your desk — signals to your nervous system that real recovery can begin.",
    counselor_flag: true,
    full_ui: false,
  },
  {
    slug: "zone-2-walking",
    name: "Zone 2 walking",
    categories: ["Physical", "Cognitive"],
    match_reason:
      "A short, easy walk between study blocks improves focus and mood without competing with study time — and the low intensity means it actually recovers you rather than depleting you.",
    counselor_flag: false,
    full_ui: false,
  },
  {
    slug: "sleep-anchor",
    name: "Sleep anchor",
    categories: ["Physical", "Structural"],
    match_reason:
      "Keeping a consistent wake time — even on weekends — is one of the highest-leverage things you can do to stabilize mood and energy across the week.",
    counselor_flag: true,
    full_ui: false,
  },
  {
    slug: "strategic-incompletion",
    name: "Strategic incompletion",
    categories: ["Cognitive", "Structural"],
    match_reason:
      "Deliberately stopping mid-task and writing one sentence about where to resume lets your brain keep processing overnight, so you return to work already partway warmed up.",
    counselor_flag: false,
    full_ui: false,
  },
  {
    slug: "workload-visibility-map",
    name: "Workload visibility map",
    categories: ["Structural"],
    match_reason:
      "Mapping every commitment for the week onto a single calendar view makes the workload feel finite — which is the first step to feeling like it's manageable.",
    counselor_flag: false,
    full_ui: false,
  },
]

// ─── Recommendation engine ─────────────────────────────────────────────────────
// Scores each exercise by how well it matches the student's PHQ / GAD pattern.
// Guarantees at least one full_ui: true exercise in the returned top 5 so
// there is always at least one guided exercise the student can start.

export function getRecommendedExercises(phqScore: number, gadScore: number): Exercise[] {
  const weights: Record<string, number> = {
    "pre-sleep-review":        phqScore >= 5  ? 2 : 0,
    "brain-dump":              phqScore >= 5  ? 1 : 0,
    "time-boxing":             gadScore >= 5  ? 1 : 0,
    "stress-reappraisal":      gadScore >= 10 ? 2 : 0,
    "process-journaling":      phqScore >= 10 ? 3 : 0,
    "hard-shutdown-ritual":    phqScore >= 10 ? 2 : 0,
    "zone-2-walking":          (phqScore + gadScore) >= 10 ? 1 : 0,
    "sleep-anchor":            phqScore >= 5  ? 2 : 0,
    "strategic-incompletion":  gadScore >= 5  ? 1 : 0,
    "workload-visibility-map": gadScore >= 5  ? 1 : 0,
  }

  const scored = EXERCISES
    .map((ex) => ({ ex, weight: weights[ex.slug] ?? 0 }))
    .sort((a, b) => b.weight - a.weight)

  const top5 = scored.slice(0, 5).map((s) => s.ex)

  // Full-UI guarantee: if none of the top 5 has full_ui, inject the
  // highest-weighted full_ui exercise in place of the lowest-ranked slot.
  const hasFullUi = top5.some((ex) => ex.full_ui)
  if (!hasFullUi) {
    const bestFullUi = scored.find((s) => s.ex.full_ui)
    if (bestFullUi) top5[4] = bestFullUi.ex
  }

  return top5
}
