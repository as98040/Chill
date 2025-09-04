
# ChillFeed — 24h Ephemeral Social (GitHub-backed)

A minimal Facebook-like feed you can deploy quickly. Stores posts/likes/comments as JSON files
in a GitHub repo via the GitHub Contents API. Data is **visible for up to 24 hours**—
a daily cleanup job deletes anything older than 24 hours.

## Features
- Create posts (text + optional image URL)
- Like and comment
- Feed shows only last 24h items
- No accounts (display name stored locally only)
- GitHub-backed storage via repo contents
- Cleanup endpoint + GitHub Action to purge data >24h

## 1) Create a data repo
- On GitHub, create an empty repo, e.g. `chillfeed-data` (public or private).
- Create a Personal Access Token (classic) with `repo` scope (or fine-grained allowing contents read/write).

## 2) Configure & run locally
```bash
npm install
cp .env.example .env
# edit .env with your token, owner, repo
npm run dev
# open http://localhost:3000
```

## 3) Deploy (Render — free/easy)
- Push this project to your GitHub
- On https://render.com > New > Web Service > select your repo
- Runtime: Node 18+; Build command: `npm install`; Start command: `npm start`
- Add environment variables from `.env` (without quotes)
- Deploy; visit the URL Render gives you

(Railway, Fly.io, or any Node host also works.)

## 4) Set up daily cleanup
- In your **app repo** (this one), keep the provided GitHub Action. It calls your app's `/api/cleanup` daily.
- Set `APP_BASE_URL` GitHub secret in the app repo to your deployed URL (e.g., `https://your-render.onrender.com`).

## Notes
- Do **not** expose your GitHub token in the browser; the token lives on the server only.
- This is a demo. Rate limits (GitHub API) and eventual consistency apply.
- For images, the app links to a URL; it does not upload images.
- Security: no auth; public write. For private deployments, add server-side auth or IP allow-lists.
- Compliance: The app filters out items older than 24h and the cleanup job deletes them in the data repo.
```

