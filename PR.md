# PR Description

## Title
feat: Pipecat Voice Integration, Sarvam AI Wrapper, and UI Improvements

## Summary
This Pull Request introduces a new voice interaction mode using Pipecat, adds an OpenAI-compatible wrapper for Sarvam AI, and significantly improves the responsiveness and layout of the `/learn` page. It also addresses several bugs related to settings persistence.

## Key Changes

### 1. Pipecat Voice Integration
- **New Service**: Implemented `PipecatClient` in `src/lib/services/pipecat.ts` to handle WebRTC audio streaming and signaling.
- **Settings**: Added "Enable Pipecat Voice" toggle and "Pipecat Server URL" configuration in `Settings > Audio` (`src/lib/components/chat/Settings/Audio.svelte`).
- **UI Integration**: Updated `CallOverlay.svelte` to conditionally use `PipecatClient` instead of the default voice handler when enabled.
- **Signaling**: Configured signaling to point to the correct `/api/offer` endpoints.

### 2. Sarvam AI Wrapper
- **New Wrapper**: Added a standalone Node.js service in `wrappers/sarvam-ai-wrapper-openai-sdk-compatible` that adapts Sarvam AI's API to be compatible with the OpenAI SDK.
- **Controller**: Implemented `openai-sdk-compatible.controller.ts` to handle chat completion requests and stream responses.

### 3. UI/UX Enhancements (`/learn` Page)
- **Responsiveness**: Optimized the grid layout to adapt seamlessly across Mobile, Tablet, and Desktop screens.
- **Sidebar Fix**: Resolved an issue where the sidebar overlapped content on desktop. Added dynamic margins (`md:ml-[var(--sidebar-width)]`) to respect the sidebar state.
- **Mobile Navigation**: Added a floating "Hamburger" menu button (using `MenuLines` icon) for easier sidebar access on mobile devices.

### 4. Bug Fixes & Refactoring
- **Settings Persistence**: Fixed a `ReferenceError` in `Audio.svelte` (variable case mismatch `sttEngine` vs `STTEngine`) that prevented settings from loading and saving correctly.
- **Documentation**: Added `START.md` to guide users on how to run the Backend, Frontend, and Wrapper services simultaneously.

## Testing Instructions

### Pipecat Voice
1.  Navigate to **Settings > Audio**.
2.  Toggle **Enable Pipecat Voice** to ON.
3.  Set the **Pipecat Server URL** (default: `http://localhost:7860`).
4.  Save and refresh the page.
5.  Enter Voice Mode in a chat and verify connection.

### Sarvam AI Wrapper
1.  Ensure the wrapper is running (`npm run dev` in `wrappers/sarvam-ai-wrapper-openai-sdk-compatible`).
2.  Configure OpenWebUI to point to the wrapper's URL (e.g., `http://localhost:3000`).
3.  Test chat completions.

### `/learn` Page
1.  Navigate to `/learn`.
2.  **Desktop**: Toggle the sidebar and verify content adjusts correctly without overlap.
3.  **Mobile**: Resize browser window. Verify the layout becomes a single column and the floating menu button appears and functions.

## Checklist
- [x] Code compiles and runs without errors.
- [x] Settings persistence verified.
- [x] UI responsiveness verified on multiple breakpoints.
- [x] New services (Pipecat, Wrapper) documented in `START.md`.
