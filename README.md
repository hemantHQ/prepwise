# AI Mock Interview App

Responsive full-stack mock interview app using a separate HTML/CSS/JS frontend and Node/MongoDB/Gemini backend.

## Features

- Sign up and sign in with JWT authentication.
- Dashboard with interview history, analytics, and progress graph.
- Light/dark theme toggle that defaults to the system color scheme.
- Interview setup for job role, experience level, interview type, skills, and optional resume PDF.
- Gemini-generated interview questions.
- Gemini answer evaluation for confidence, clarity, technical accuracy, communication, strengths, weaknesses, and improvement tips.
- MongoDB persistence for users, sessions, answers, and final reports.
- GitHub Pages deployment workflow in `.github/workflows/deploy-frontend.yml`.
- Render deployment blueprint in `render.yaml`.

## Local Setup

## Project Structure

```text
frontend/   Static GitHub Pages app
backend/    Render-hosted API
render.yaml Render blueprint for backend
```

## Local Setup

1. Install backend dependencies:

```bash
cd backend
npm install
```

2. Copy `backend/.env.example` to `backend/.env` and fill in:

```bash
MONGODB_URI=...
GEMINI_API_KEY=...
JWT_SECRET=...
```

3. Start the backend:

```bash
npm start
```

4. Open `frontend/index.html` in a browser, or serve the folder with any static server.

For GitHub Pages deployment, add this repository secret:

```text
BACKEND_API_URL=https://your-render-service.onrender.com
```

If `GEMINI_API_KEY` is missing, the app uses fallback questions and feedback so the flow can still be tested.
