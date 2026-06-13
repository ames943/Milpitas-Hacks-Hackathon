## Inspiration

In the Bay Area, performing at 100% is not an achievement. It is the minimum. The students who need mental health support the most are also the least likely to seek it, because every tool they find asks them to slow down, do less, or accept lower output. We designed around that constraint from day one: every intervention in Mosaic reduces the cost of performance rather than performance itself.

The idea came from weather forecasting. Meteorologists do not ask the atmosphere how it is doing. They combine pressure, humidity, wind, and temperature because no single signal tells the full story. Mental health works the same way, but every tool built for students today only looks at one signal at a time. We built the thing that listens to what students cannot say.

---

## What it does

Mosaic predicts mental health across three dimensions (Cognitive Load, Emotional Regulation, Recovery Capacity) by combining a PHQ-A and GAD-7 survey, an academic transcript, sleep data from Apple Health or Google Fit, and a 60-second voice recording analyzed for pitch variance and flat affect. Each signal raises a visible confidence score. The output is a personalized dashboard with AI explanations tied to the student's actual data, and five curated exercises matched to their specific pattern.

---

## How we built it

Node.js and Express backend in TypeScript, Supabase for the database, and all AI calls routed through Backboard.io using Claude Sonnet. The voice pipeline runs real acoustic analysis server-side (YIN pitch detection, adaptive noise threshold, 20ms frames at 44.1kHz) with no third-party audio dependency. The recommendation engine uses a two-stage approach: deterministic category pre-filtering followed by Claude selecting and explaining exactly five exercises. Backboard's memory API stores a snapshot after every submission, giving Claude longitudinal context on return visits.

---

## Challenges we ran into

Building the voice pipeline from scratch without a third-party service. Getting confidence recalculation right when signals are deleted so the longitudinal history stays intact. And auditing every word of copy to ensure nothing ever implied diagnosis or suggested the student had a problem, because the product only works if it never says that.

---

## Accomplishments that we're proud of

A voice analysis pipeline with no third-party dependency. A confidence score mechanic that makes the tradeoff of sharing data legible without guilt. A synthetic demo student showing a five-week decline that a survey-only tool would have missed. And 197 unit tests with zero failures.

---

## What we learned

Framing is a product decision, not a marketing one. The choice to never use the words mental health in onboarding, to label dimensions by functional names, and to frame everything around performance had to be made at the architecture level. And the multimodal argument proved itself during building: every time we tested with one signal, the scores felt thin. With all four, the picture sharpened immediately.

---

## What's next for Mosaic

Expanding the exercise library to 50 to 100 options, integrating Omi AI wearables for continuous passive signal collection, and building a counselor-facing dashboard showing anonymized aggregate trends across a school population so counselors can see where to focus attention before students hit a crisis.
