# Technology Stack

**Analysis Date:** 2026-04-06

## Languages

**Primary:**
- TypeScript 5.9.3 - Frontend application, strict type checking enabled
- Python 3 - Telegram bot (`tg-bot/`) for message collection and analysis

**Secondary:**
- JavaScript - Build tooling configuration, ESLint setup
- HTML5 - Application shell (`index.html`)
- CSS3 - Styling (module CSS + inline)

## Runtime

**Environment:**
- Node.js (LTS recommended) - Web frontend execution
- Python 3.10+ - Bot environment

**Package Manager:**
- npm - Node.js package management
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- React 19.2.4 - UI library with concurrent features
- React DOM 19.2.4 - DOM rendering
- React Router DOM 7.14.0 - Client-side routing and navigation

**UI & Visualization:**
- Leaflet 1.9.4 - Interactive map library
- react-leaflet 5.0.0 - React binding for Leaflet
- leaflet.heat 0.2.0 - Heatmap visualization plugin
- Recharts 3.8.1 - Chart and data visualization (bar, line, area charts)
- lucide-react 1.7.0 - Icon library

**Data & Export:**
- XLSX 0.18.5 - Excel file parsing and generation
- html2canvas 1.4.1 - DOM to canvas conversion for screenshots
- jsPDF 4.2.1 - PDF generation from canvas/DOM

**Utilities:**
- date-fns 4.1.0 - Date manipulation and formatting
- clsx 2.1.1 - Conditional CSS class utility

**Testing & Dev:**
- Vite 8.0.1 - Build tool and dev server
- @vitejs/plugin-react 6.0.1 - React support for Vite (with Oxc)
- ESLint 9.39.4 - Code linting
- @eslint/js 9.39.4 - Core ESLint rules
- typescript-eslint 8.57.0 - TypeScript linting support
- eslint-plugin-react-hooks 7.0.1 - React hooks rules
- eslint-plugin-react-refresh 0.5.2 - React Fast Refresh support
- tsx 4.21.0 - TypeScript Node runner
- TypeScript 5.9.3 - Language and compilation

## Key Dependencies

**Critical:**
- @supabase/supabase-js 2.101.1 - Supabase client for database, auth, Edge Functions, and RPC calls. Core dependency for all data operations.
- firebase 12.11.0 - Imported but usage not found in codebase; likely legacy dependency

**Mapping & Geolocation:**
- leaflet 1.9.4 - Interactive maps backend
- react-leaflet 5.0.0 - React component wrapper
- leaflet.heat 0.2.0 - Heatmap rendering on maps
- @types/leaflet 1.9.21 - TypeScript definitions

**Bot & External Integrations:**
- telethon - Python Telegram client (in `tg-bot/bot.py`)
- httpx - Python async HTTP client (for DeepSeek API in `tg-bot/analyzer.py`)

## Configuration

**Environment:**
- Vite environment variables via `import.meta.env` with `VITE_` prefix
- Required env vars:
  - `VITE_SUPABASE_URL` - Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` - Supabase public anonymous key
- Configuration file: `.env` (local, contains secrets)

**Build:**
- `vite.config.ts` - Vite configuration with React plugin
- `tsconfig.json` - TypeScript root configuration (references `tsconfig.app.json` and `tsconfig.node.json`)
- `tsconfig.app.json` - Application-specific TypeScript configuration
- `tsconfig.node.json` - Build tooling TypeScript configuration
- `eslint.config.js` - ESLint configuration with flat config (ESLint 9+)

**Bot Configuration:**
- `tg-bot/.env` - Bot environment variables (Telegram API credentials, DeepSeek API key, analysis interval)

## Platform Requirements

**Development:**
- Node.js 18+ (Vite requirement)
- npm 9+
- TypeScript support in editor
- Python 3.10+ (for bot development)

**Production:**
- Node.js 18+ runtime for web frontend
- Vite static output (`dist/`) deployable to any static hosting
- Python 3.10+ for bot service (runs separately)
- PostgreSQL database (via Supabase)

## Entry Points

**Web Frontend:**
- `src/main.tsx` - React application entry point
- `index.html` - HTML document root
- `src/app/App.tsx` - Main React component with routing and auth gate

**Bot:**
- `tg-bot/bot.py` - Telegram bot listener and coordinator
- `tg-bot/analyzer.py` - Message analysis via DeepSeek API

## Build Commands

```bash
npm run dev      # Start Vite dev server (HMR enabled)
npm run build    # TypeScript compilation + Vite production build
npm run lint     # ESLint check all TS/TSX files
npm run preview  # Preview production build locally
```

---

*Stack analysis: 2026-04-06*
