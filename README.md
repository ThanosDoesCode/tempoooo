# Lean Bulk Journal

Challenge push notification deployment, security notes, and the two-account test checklist:
[docs/challenge-push-notifications.md](docs/challenge-push-notifications.md).

Build a mobile-first fitness progress tracking web app called Lean Bulk Tracker.

The app is for one person following a 12-month lean bulk from September 2026 to September 2027.

Starting profile:

Age: 21

Height: 177 cm

Starting weight: 61 to 62 kg

Target weight: 75 kg

Starting calories: approximately 2,900 kcal/day

Target rate of weight gain: 0.2 to 0.3 kg per week

Training: 5 gym sessions per week

Cardio varies because university cycling changes week to week

Main goal: maximize muscle gain while keeping body-fat gain controlled and abs visible

The most important requirement is that the app makes progress extremely easy to record and creates clean summary screens that can be screenshotted and sent to ChatGPT for analysis.

Do not make this app complicated. Prioritize speed of logging, clear information hierarchy and excellent mobile UX.

DESIGN

Use a premium, minimal fitness-dashboard aesthetic.

Style:

Dark mode by default

Large readable numbers

Clean cards

Rounded corners

Modern typography

Subtle animations

Excellent contrast

No visual clutter

Mobile-first

Bottom navigation

Important numbers visible immediately

Green / neutral positive indicators and subtle warning states

Do not make it look like a bodybuilding bro app

Make it feel like a polished modern health and performance product

Navigation:

Today

Training

Progress

Check-In

SCREEN 1: TODAY / DAILY LOG

At the top show:

Current date

Current 7-day average weight

Current calorie target

Days completed this week

Create a very fast daily input form.

Fields:

Morning

Bodyweight in kg

Optional waist measurement in cm

Sleep duration in hours

Sleep quality: 1 to 5

Nutrition

Do not require logging every food individually.

Fields:

Calories consumed

Protein in grams

Carbs in grams

Fat in grams

Creatine taken: yes/no

Water intake in litres

Pre-fill targets:

Calories: 2,900 kcal

Protein: 130 g

Fat target range: approximately 80 to 90 g

Creatine: 5 g

Show progress bars against each target.

Activity

Steps

Cycling distance in km

Running distance in km

Optional cardio duration

Optional note

University cycling is important because activity can vary significantly week to week.

Gym

Gym session today: yes/no

Workout type:



Chest & Back

Legs

Arms & Shoulders

Rest

Link to the Training screen for detailed exercise logging

At the bottom:

Save Day button

Show completion percentage for the day

The entire daily log should take less than one minute to complete.

SCREEN 2: TRAINING

Allow logging workouts by exercise.

Current exercises:

Chest & Back:

Incline Dumbbell Press

Cable Low-to-High Fly

Pull-Ups

Cable Rows

Face Pulls

Legs:

Declined Leg Press

Leg Extensions

Romanian Deadlifts / RDL

Leg Curls

Calf Raises

Arms & Shoulders:

Chin-Ups

Incline Dumbbell Curls

Tricep Pushdowns

Overhead Tricep Extensions

Lateral Raises

For every exercise store:

Weight

Set 1 reps

Set 2 reps

Set 3 reps

Optional notes

Show the previous workout’s numbers beside the current workout so progression is obvious.

Highlight:

New weight PR

New rep PR

Same performance

Regression

Main progression rule:
Increase reps within the target range. Once the top of the range is reached with good form, increase weight.

Allow historical exercise graphs for:

Weight used

Best reps

Estimated progression over time

SCREEN 3: PROGRESS

This screen should visualize long-term progress.

Top cards:

Current weight

Starting weight

Target weight

Total gained

Remaining kg

Current 7-day average

Average weekly gain

Charts:

Weight

Show:

Daily weight as faint points

7-day average as the main line

Starting weight

75 kg target line

Waist

Show weekly waist measurement over time.

Calories

Show average daily calories by week.

Activity

Show weekly:

Cycling km

Running km

Steps average

Strength

Show whether major exercises are trending upward.

Include month selector:
September 2026 through September 2027.

PROGRESS PHOTOS

Create a photo section.

Every 4 weeks allow uploading:

Front photo

Side photo

Back photo

Store date and weight with each photo.

Create side-by-side comparison mode:

Starting photo

Current photo

Keep photos private to the user.

SCREEN 4: WEEKLY CHECK-IN

THIS IS THE MOST IMPORTANT SCREEN.

Design this specifically so I can take ONE screenshot and send it to ChatGPT.

Everything important should fit cleanly on one mobile screen, or have a dedicated “Share Summary” mode optimized for screenshots.

Show:

WEEK

Example:
September 7 to September 13

BODY

Starting weight this week

Ending weight

7-day average weight

Previous week’s 7-day average

Weekly change in kg

Waist this week

Waist change

NUTRITION

Average calories/day

Average protein/day

Average carbs/day

Average fat/day

Number of days calorie target was hit

TRAINING

Gym sessions completed out of 5

Number of exercises that progressed

Number that stayed the same

Number that regressed

Any new PRs

ACTIVITY

Average steps/day

Total running km

Total cycling km

Total cardio sessions

RECOVERY

Average sleep hours

Average sleep score

AUTOMATIC STATUS

Based on weight trend show one of:

ON TARGET
Weekly weight gain is between 0.2 and 0.3 kg.

TOO SLOW
Weight gain is below the target range.

TOO FAST
Weight gain is above the target range.

Do not automatically change calories.

Instead display:
“Review with ChatGPT before adjusting calorie intake.”

NOTES

One short text field:
“Anything unusual this week?”

Examples:

Sick

Missed gym

Ate out

Travelled

Cycled to university 5 days

Poor sleep

Very sore

CHATGPT SCREENSHOT MODE

Add a button:
Generate ChatGPT Check-In

This creates a clean screenshot-friendly card with ONLY:

LEAN BULK CHECK-IN

Date range:
Current weight:
7-day avg:
Previous 7-day avg:
Weekly change:
Waist:
Waist change:

Avg calories:
Avg protein:
Avg carbs:
Avg fat:

Gym sessions:
Exercises progressed:
PRs:

Cycling:
Running:
Avg steps:

Avg sleep:

Notes:

Current calorie target:

Do not include navigation, buttons or unnecessary UI in this mode.

Make all text large enough to be read clearly from a screenshot.

Also include a small trend indicator beside:

Weight

Waist

Calories

Gym performance

This is the screen I will screenshot and send to ChatGPT every week.

MONTHLY CHECK-IN

Create a similar monthly summary designed for screenshot sharing.

Show:

Starting monthly weight

Ending monthly weight

Monthly average

Total weight gained

Average weekly gain

Waist change

Average calories

Average protein

Average fat

Gym sessions completed

Strength progression

Running total

Cycling total

Average sleep

Progress photo thumbnails

Current calorie target

Also show:
“Suggested decision: Review calories / Keep calories unchanged”

Do NOT make the calorie adjustment automatically.

DATA MODEL

Store:

User profile

Daily logs

Weight entries

Waist entries

Nutrition entries

Activity entries

Sleep entries

Workouts

Exercises

Sets

Progress photos

Weekly summaries

Monthly summaries

Current nutrition targets

Persist all historical data.

IMPORTANT CALCULATIONS

Calculate 7-day average weight automatically.

Do not react to single-day weight changes.

Weekly weight change should compare:
Current week’s 7-day average vs previous week’s 7-day average.

Target gain:
0.2 to 0.3 kg/week.

Show the result clearly but do not make dietary decisions automatically.

CONSISTENT MEASUREMENT REMINDER

Include a small reminder in the morning weight entry:

“Weigh yourself after using the bathroom, before food or drink, with no clothes or similar clothing, on the same scale and same floor position.”

For waist:

“Measure once per week in the morning, relaxed, at the navel.”

For photos:

“Take every 4 weeks in the same location, lighting, distance and pose.”

FINAL UX REQUIREMENT

The app should feel like something I genuinely want to open every morning.

Daily logging should be extremely fast.

Weekly analysis should require no manual calculations.

The weekly ChatGPT Check-In screenshot should contain everything needed for an external coach or AI to decide:

whether weight gain is appropriate

whether calories need changing

whether activity increased

whether strength is progressing

whether fat gain appears excessive

whether recovery may be limiting progress

Build the complete responsive UI and functional data structure for this experience.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://trexavlaka.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a8577b6d-afee-4ca9-8d73-3a09d120aad8).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
