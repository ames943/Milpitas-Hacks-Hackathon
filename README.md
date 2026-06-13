## Inspiration

Every app we found that claimed to support student mental health did the same thing: it asked how you felt. A survey. A check-in. A mood log. The problem is that the students who need help the most are also the least likely to accurately report how they feel, or report at all. In the Bay Area, performing at 100% is not an achievement. It is the minimum. Slowing down is not an option these students consider, which means any tool that asks them to do less, rest more, or lower their expectations is a tool they will never open twice.

We kept coming back to weather forecasting. Meteorologists do not ask the atmosphere how it is doing. They read pressure, humidity, wind speed, and temperature because no single signal tells the full story. Mental health works the same way, but every tool built for students today only looks at one signal at a time.

The constraint we designed around from day one was this: we would never suggest anything that required a student to perform less. Every intervention in Mosaic is chosen specifically because it reduces the cost of performance rather than performance itself. Better sleep consolidation so studying takes less time. Brain dumps that close mental open loops so working memory runs cleaner. Stress reappraisal that converts anxiety into focus rather than suppressing it. The goal is not a healthier student who does less. It is a student who can sustain the same output without burning through the cognitive and emotional resources that make it possible.

We wanted to build the thing that listened to what students could not say, and gave back something they would actually use.

---

## What it does

Mosaic predicts mental health across three dimensions (Cognitive Load, Emotional Regulation, and Recovery Capacity) by combining multiple passive and active signals into a single confidence-scored picture.

Users start with a short survey (PHQ-A and GAD-7, restyled as a conversational flow rather than a clinical form). From there, they can optionally add three passive signals: an academic transcript that Claude parses for GPA trends and course load; sleep data exported from Apple Health or Google Fit; and a 60-second voice recording analyzed for pitch variance, flat affect, and speaking patterns. Each signal raises a visible confidence score. The more signals provided, the sharper the picture.

The output is a dashboard showing all three dimensions with color-coded bars, plain-language AI explanations tied to the student's actual data, and five personalized exercises curated from a research-backed library. Every exercise is specifically chosen because it reduces the cost of performance rather than performance itself.

Mosaic also builds longitudinal memory using Backboard.io. Every visit creates a timestamped snapshot. After two or more visits, a trend view appears showing whether each dimension is improving, stable, or worsening over time, which is something a single-signal tool running once could never catch.

---

## How we built it

The backend is Node.js and Express in TypeScript, with Supabase as the database. All AI calls route through Backboard.io using Claude Sonnet, which handles transcript extraction, plain-language dashboard explanations, and the two-stage exercise recommendation engine. Backboard's persistent memory API stores a snapshot after every data submission, giving Claude longitudinal context on return visits.

Signal processing is done entirely server-side. The voice pipeline runs real acoustic analysis (20ms frames at 44.1kHz, adaptive noise threshold at 1.5x the p10 noise floor, and YIN pitch detection) without any third-party audio AI. Sleep CSV parsing uses defensive column matching to handle Apple Health, Google Fit, and generic export formats. Transcript extraction sends the raw PDF text to Claude and validates the structured output before applying it.

The recommendation engine runs in two stages: a deterministic category pre-filter builds a priority set from dimension scores and selects the top 8 candidate exercises, then Claude selects exactly 5 and writes a personalized match reason for each. A full-UI guarantee ensures at least one interactive exercise always appears in the recommendations.

The frontend is built in React using v0, deliberately framed around performance optimization rather than mental health, because the target user would close a tab the moment they saw a crisis hotline banner.

---

## Challenges we ran into

The hardest single problem was making the voice pipeline reliable without using a third-party service. Real acoustic analysis from raw audio bytes (adaptive noise flooring, YIN pitch detection, frame-level energy variance) required building the signal processing from scratch and writing 47 tests against synthetic tones before we trusted the output.

The second challenge was the confidence scoring system. We wanted it to feel transparent and motivating rather than punitive. Getting the math right so that signal deletion correctly recalculates confidence, re-inserts a new snapshot, and updates the dashboard without breaking the longitudinal history took more iterations than expected.

The third was framing. Every word of copy, every label on a dashboard bar, and every piece of onboarding text had to be audited to make sure it never used clinical language or implied diagnosis. The target user is not someone who thinks they have a problem. The product only works if it never suggests they might.

---

## Accomplishments that we're proud of

The voice analysis pipeline running entirely server-side with no third-party dependency, producing acoustic features that measurably shift emotional regulation scores, is the thing we are most proud of technically.

The confidence score mechanic (showing exactly how much each unsubmitted signal would raise the score before the user commits to sharing it) solves a real product problem elegantly. It builds the case for data sharing into the interface without nagging.

The synthetic demo student, seeded with five weekly snapshots showing a decline that a survey-only tool would have missed, makes the core pitch argument demonstrable in under 30 seconds.

And 197 unit tests with zero failures across a backend that touches real acoustic analysis, AI calls, CSV parsing, PDF extraction, and longitudinal memory is something worth noting.

---

## What we learned

No single signal is enough, and that turned out to be true during development as much as in the pitch. Every time we tested with only one data source, the dimension scores felt thin. The moment all three passive signals were present alongside the survey, the picture sharpened in a way that was immediately obvious. The product argument proved itself during building.

We also learned that framing is a product decision, not a marketing one. The choice to never use the words mental health in the onboarding flow, to label dimensions by their functional names rather than clinical ones, and to frame exercises around performance rather than recovery were all decisions that had to be made at the architecture level, not bolted on at the end.

---

## What's next for Mosaic

The most immediate next step is expanding the exercise library from 10 to the originally planned 50 to 100 options, with full UI interfaces for at least 15. The recommendation engine already supports this. The library just needs to be populated.

The second is real hardware integration. The pitch references Omi AI as a potential wearable partner for continuous passive signal collection (heart rate variability, ambient voice monitoring, movement). The backend signal pipeline is designed to accept new signal types without structural changes.

The third is a counselor-facing view. The app currently surfaces a counselor nudge when two or more dimensions are in the red band. The logical next step is a dashboard schools can use to see anonymized aggregate trend data across their student population, not individual records, but pattern-level signals that let counselors know where to focus attention before students hit a crisis.

GPS and location data, flagged as a privacy risk for minors in early planning, remains on the roadmap as a future feature with explicit opt-in and parental consent flows.

The longitudinal memory that Backboard.io enables becomes more valuable the longer a student uses the app. The trend view after two visits is just the beginning. With six months of snapshots, Mosaic can start identifying the specific conditions that precede a student's bad weeks, not just describe the current state.
