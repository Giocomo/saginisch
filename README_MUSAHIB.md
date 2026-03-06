# Musahib Gemini backend

This bundle gives your existing invite page a real backend endpoint for the Musahib chat UI.

## Files

- `index.html` — your invite page with the chat UI already wired to `POST /api/musahib`
- `api/musahib.js` — serverless backend that calls Gemini
- `.env.example` — environment variable template

## Deploy on Vercel

1. Put these files in one project folder.
2. In Vercel, create a new project from that folder/repo.
3. Add an environment variable:
   - `GEMINI_API_KEY` = your Gemini API key
4. Deploy.

Vercel will serve:
- `/` → `index.html`
- `/api/musahib` → the serverless function

## How it works

The browser sends the message, conversation history, guest info, and system prompt to `/api/musahib`.
The backend calls Gemini securely with your API key and sends the reply text back to the page.

## Local testing

This backend is written in Vercel-style serverless format. The easiest route is deploying on Vercel.
If you want a plain Node/Express version later, that can be added too.
