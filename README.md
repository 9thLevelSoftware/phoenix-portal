# Phoenix Portal

Web companion dashboard for [Project Phoenix](https://github.com/DasBluEyedDevil/Project-Phoenix-MP) - the community rescue project keeping Vitruvian Trainer workout machines functional.

## Overview

Phoenix Portal is a **companion mode** web dashboard that displays workout data synced from the Project Phoenix mobile app. It provides:

- **Dashboard** - Overview of recent workouts and stats
- **Analytics** - Detailed charts and progress tracking
- **Workout History** - Browse past sessions
- **Personal Records** - Track PRs and 1RM calculations
- **Routines** - View and manage workout routines
- **Training Cycles** - Periodization planning
- **Challenges** - Community challenges and leaderboards

> **Note:** This is a view-only companion app. All workout control happens in the mobile app.

## Tech Stack

- **Vite** - Build tool
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS v4** - Styling
- **shadcn/ui** - Component library
- **Recharts** - Charts and graphs
- **Framer Motion** - Animations

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

The dev server runs at `http://localhost:5173`.

## Deployment

Build the `dist/` folder and deploy to any static hosting:

- Vercel
- Netlify
- Railway (static site)
- GitHub Pages

## Related Projects

- [Project Phoenix Mobile App](https://github.com/DasBluEyedDevil/Project-Phoenix-MP) - Kotlin Multiplatform app for iOS/Android

## License

MIT
