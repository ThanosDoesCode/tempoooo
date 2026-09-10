# Tempo

Tempo is a mobile-first fitness tracking PWA for long-term training, nutrition, recovery, and progress monitoring.

It was built to make daily logging fast, keep historical progress structured, and generate clear weekly summaries that can be reviewed externally without manual calculations.

[Open the live app](https://tempoooo.lovable.app)

## Overview

Tempo combines daily health tracking, structured workout logging, progress analytics, weekly check-ins, progress photos, and challenge-based accountability in one responsive application.

The project started as a personal lean-bulk tracker and evolved into a broader fitness platform with reusable workout structures, challenge tracking, push notifications, secure user data, and mobile-first workflows.

## Features

### Daily Tracking

Track:

- Bodyweight
- Waist measurements
- Calories and macros
- Creatine and water intake
- Sleep duration and quality
- Steps
- Cycling
- Running
- Cardio
- Daily notes

The interface is designed so a full daily entry can be completed quickly from a phone.

### Workout Tracking

Create and complete structured training sessions with:

- Exercises
- Sets
- Weight
- Repetitions
- Exercise notes
- Previous-session performance
- Progression tracking
- Personal records

Workout history makes it easy to compare current performance with previous sessions.

### Progress Analytics

Tempo calculates and visualizes:

- Daily bodyweight
- 7-day average weight
- Weekly weight change
- Waist progression
- Weekly calorie averages
- Running and cycling volume
- Step averages
- Strength progression
- Long-term trends

The app focuses on trends rather than reacting to individual daily measurements.

### Weekly Check-Ins

Tempo automatically creates weekly summaries containing:

- Current and previous weight averages
- Weekly weight change
- Waist change
- Nutrition averages
- Training completion
- Exercise progression
- Personal records
- Activity
- Sleep
- Notes

A dedicated screenshot-friendly summary makes it easy to share the week's data with a coach or AI for analysis.

### Progress Photos

Users can store periodic:

- Front photos
- Side photos
- Back photos

Photos can be compared over time alongside bodyweight and date information.

### Fitness Challenges

Tempo also supports shared fitness challenges with:

- Challenge creation
- Activity submissions
- Evidence images
- Weekly challenge history
- Participant progress
- Activity scoring
- Push notifications

Challenge data and uploaded evidence are protected using Supabase Row Level Security and private storage policies.

### Push Notifications

Push notifications are implemented with OneSignal and Supabase Edge Functions.

Notifications can be triggered by challenge activity while keeping privileged credentials server-side.

See the technical documentation:

[Challenge push notification documentation](docs/challenge-push-notifications.md)

## Tech Stack

### Frontend

- React
- TypeScript
- Vite
- TanStack Router
- TanStack Query
- PWA APIs

### Backend

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Edge Functions
- Row Level Security

### Notifications

- OneSignal

### Development

- Git
- GitHub
- Lovable
- AI-assisted development workflows

## Security

Tempo uses Supabase Row Level Security to isolate user data.

Security measures include:

- RLS-protected database tables
- Private storage buckets
- Authenticated access to user-owned data
- Server-side privileged operations
- Environment-based secret management
- No service-role credentials exposed to the client
- HTTPS-only evidence URLs

Public Supabase configuration uses the publishable client key, while privileged credentials remain server-side.

## Architecture

The application separates client-side Supabase access from privileged server-side operations.

Client-side requests use the Supabase publishable key and rely on Row Level Security policies for authorization.

Privileged operations use server-side Supabase clients and Edge Functions where required.

TanStack Query is used for asynchronous state management, caching, and server-state synchronization.

The application is designed around a mobile-first interface while maintaining responsive desktop support.

## Local Development

### Requirements

- Node.js
- npm

Clone the repository:

```sh
git clone https://github.com/ThanosDoesCode/tempoooo.git
cd tempoooo
```

Install dependencies:

```sh
npm install
```

Create a local environment file:

```sh
cp .env.example .env
```

Add your public Supabase configuration to `.env`.

Start the development server:

```sh
npm run dev
```

## Environment Variables

Client-side development requires:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Additional hosted environment variables are managed by Supabase and the deployment environment.

Privileged credentials such as:

```env
SUPABASE_SERVICE_ROLE_KEY
```

must never be exposed in client-side code.

## Project Structure

```text
src/
  integrations/
  lib/
  routes/
  components/

supabase/
  functions/
  migrations/

docs/
  challenge-push-notifications.md

tests/
```

## Development Workflow

Tempo is connected to Lovable and GitHub.

Changes can be developed through:

- Lovable
- Local development
- GitHub
- AI-assisted coding workflows

Changes pushed to the connected GitHub repository remain synchronized with the Lovable project.

## Project Status

Tempo is actively being developed.

Current areas of focus include:

- Training progression
- Challenge workflows
- Push notification reliability
- Mobile UX
- Account onboarding
- Progress analytics
- Security hardening

## Author

**Thanos Xyntarakis**

Computer Science student in Sweden building full-stack applications and AI-assisted software projects.

[GitHub](https://github.com/ThanosDoesCode)

[LinkedIn](https://www.linkedin.com/in/thanosxnt)
