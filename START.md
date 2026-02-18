# Project Startup Guide

This project consists of three main components that need to be running simultaneously: the Backend (Python), the Frontend (SvelteKit), and the Sarvam AI Wrapper (Node.js).

Follow these steps to start the complete system.

## Prerequisites
- Node.js (v18+)
- Python (v3.11+)
- Git

## 1. Start the Backend (OpenWebUI)
This handles the API, database, and user settings.

1.  Open a terminal.
2.  Navigate to the backend directory:
    ```powershell
    cd backend
    ```
3.  Run the local startup script:
    ```powershell
    .\run_local.bat
    ```
    *This will start the FastAPI server on port 8080.*

## 2. Start the Sarvam AI Wrapper
This is the custom OpenAI-compatible wrapper for Sarvam AI.

1.  Open a **new** terminal.
2.  Navigate to the wrapper directory:
    ```powershell
    cd wrappers\sarvam-ai-wrapper-openai-sdk-compatible
    ```
3.  Start the service:
    ```powershell
    npm run dev
    ```
    *This usually runs on port 3000 or similar (check terminal output).*

## 3. Start the Frontend (WebUI)
This is the main user interface.

1.  Open a **new** terminal.
2.  Navigate to the root directory (if not already there):
    ```powershell
    cd .
    ```
3.  Start the development server:
    ```powershell
    npm run dev
    ```
    *The app will be accessible at `http://localhost:5173`.*

## Troubleshooting
- **Ports**: Ensure ports `8080`, `5173`, and the wrapper port are not blocked.
- **Environment Variables**: Check that `.env` files in each directory are correctly configured (especially for API keys).
