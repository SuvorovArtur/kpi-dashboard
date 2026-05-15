# Technology Stack

**Analysis Date:** 2026-04-19

## Languages

**Primary:**
- TypeScript 5.9.3 - Application and build configuration
- JavaScript (ES2023) - React components and utilities

**Secondary:**
- Python 3 - Telegram bot and message analysis services
  - Used in: `tg-bot/bot.py`, `tg-bot/analyzer.py`

## Runtime

**Environment:**
- Node.js (version not specified in package.json, inferred from tsconfig targets: ES2023)
- Python 3 (for tg-bot services)

**Package Manager:**
- npm (lockfile: `package-lock.json` present)

## Frameworks

**Core:**
- React 19.2.4 - UI framework
- Vite 8.0.1 - Build tool and dev server

**Routing & Navigation:**
- React Router DOM 7.14.0 - Client-side routing

**Visualization & Maps:**
- Leaflet 1.9.4 - Interactive maps
- Leaflet.heat 0.2.0 - Heatmap visualization plugin
- Leaflet-image 0.4.0 - Map image export
- React-Leaflet 5.0.0 - React bindings for Leaflet
- Recharts 3.8.1 - Charts and data visualization
- html2canvas 1.4.1 - Client-side screenshot capture
- jsPDF 4.2.1 - PDF generation

**Data Import/Export:**
- XLSX 0.18.5 - Excel file parsing and generation

**UI Components & Utilities:**
- Lucide React 1.7.0 - Icon library
- clsx 2.1.1 - Conditional CSS class management
- date-fns 4.1.0 - Date manipulation and formatting

**Testing & Linting:**
- ESLint 9.39.4 - Code linting
- TypeScript ESLint 8.57.0 - TypeScript linting rules
- ESLint React Hooks 7.0.1 - React hooks linting
- ESLint React Refresh 0.5.2 - Vite react-refresh plugin linting
- tsx 4.21.0 - TypeScript execution for Node.js

**Build & Dev:**
- @vitejs/plugin-react 6.0.1 - Vite React plugin with SWC support
- globals 17.4.0 - ESLint globals configuration

**Bot/Backend (Python):**
- Telethon - Telegram client for monitoring and message collection
- httpx - Async HTTP client for API calls
- DeepSeek API integration (via httpx)

## Key Dependencies

**Critical:**
- @supabase/supabase-js 2.101.1 - Database and auth client
  - Core to all data operations, authentication, and real-time subscriptions
  - Used extensively in `src/shared/hooks/` and `src/shared/lib/supabase.ts`
  - Handles auth state, KPI data, appeals, territories, staff, heatmap, social monitor, and roadmap operations
  - Backend services (tg-bot) also use Supabase SDK

**Infrastructure:**
- React Router DOM - Application navigation and layout
- Leaflet ecosystem - Geographic visualization (maps, heatmaps)
- Recharts - Data visualization for KPI dashboards

## Configuration

**Environment Variables (Vite):**
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous API key

Loaded in: `src/shared/lib/supabase.ts`

Configuration files exist but are not in version control:
- `.env` file present (not committed, contains secrets)
- `tg-bot/.env` present (Telegram bot credentials)

**Python Bot Configuration:**
- Configuration imported from `config` module in tg-bot files
- Proxy settings stored in Supabase `app_settings` table (editable via Settings page)
- Keys: `tg_proxy_type`, `tg_proxy_host`, `tg_proxy_port`, `tg_proxy_secret`, `tg_proxy_username`, `tg_proxy_password`
- Telegram API credentials: `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`, `ANALYSIS_INTERVAL`
- DeepSeek API key: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`

**Build Configuration:**
- `vite.config.ts` - Build optimization with manual chunking for vendor bundles
  - Chunks: `vendor-react`, `vendor-charts`, `vendor-supabase`
- `tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json` - TypeScript configuration
  - Target: ES2023
  - Module: ESNext
  - Strict mode enabled
- `eslint.config.js` - ESLint configuration with React hooks and TypeScript rules

**Deployment/Infrastructure:**
- Nginx configuration file: `config/nginx-security-headers.conf`
- Frontend deployment via rsync to remote server (SSH key-based auth)

## Platform Requirements

**Development:**
- Node.js (ES2023 compatible, typically 18+)
- npm or yarn
- TypeScript 5.9.3
- Python 3 (for tg-bot services only)

**Production:**
- Frontend: Static hosting (Vite SPA), served via Nginx
  - Nginx with security headers configured
- Backend: Supabase cloud (database, auth, edge functions)
- Python services: Linux server for Telegram bot and analysis worker
  - Telethon for Telegram API
  - httpx for HTTP requests to DeepSeek
  - Systemd for service management (restart loop for config changes)

**Browsers:**
- ES2023 target implies modern browser support (Chrome 87+, Firefox 85+, Safari 16+)

---

*Stack analysis: 2026-04-19*
