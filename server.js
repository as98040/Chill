
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// --- Config ---
const GH_TOKEN = process.env.GITHUB_TOKEN;        // Create a classic PAT with repo scope (or fine-grained allowing contents:read/write)
const GH_OWNER = process.env.GITHUB_OWNER;        // e.g., your-github-username
const GH_REPO  = process.env.GITHUB_REPO;         // e.g., chillfeed-data (create empty repo first)
const BASE_PATH = "data";                          // folder in the repo
const TTL_MS = 24 * 60 * 60 * 1000;               // 24 hours

if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
  console.warn("⚠️  Missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO env vars. API routes will fail until set.");
}

const ghHeaders = {
  "Authorization": `Bearer ${GH_TOKEN}`,
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
};

const ghBase = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents`;

async function ghListDir(dir) {
  const res = await fetch(`${ghBase}/${dir}`, { headers: ghHeaders });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list error: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function ghGet(path) {
  const res = await fetch(`${ghBase}/${path}`, { headers: ghHeaders });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub get error: ${res.status} ${await res.text()}`);
  const j = await res.json();
  const content = Buffer.from(j.content || "", "base64").toString("utf-8");
  return { sha: j.sha, content };
}

async function ghPut(path, content, message) {
  const current = await ghGet(path);
  const body = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch: process.env.GITHUB_BRANCH || "main",
  };
  if (current && current.sha) body.sha = current.sha;
  const res = await fetch(`${ghBase}/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub put error: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function ghDelete(path, message) {
  const current = await ghGet(path);
  if (!current) return;
  const body = {
    message,
    sha: current.sha,
    branch: process.env.GITHUB_BRANCH || "main",
  };
  const res = await fetch(`${ghBase}/${path}`, {
    method: "DELETE",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub delete error: ${res.status} ${await res.text()}`);
  return await res.json();
}

function nowISO() { return new Date().toISOString(); }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// --- Data model ---
// Post: { id, author, text, imageUrl?, createdAt }
// Like: { id, postId, user, createdAt }
// Comment: { id, postId, user, text, createdAt }
// Stored as files: data/posts/<id>.json, data/comments/<id>.json, data/likes/<id>.json

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/feed", async (req, res) => {
  try {
    const cutoff = Date.now() - TTL_MS;
    const postsDir = `${BASE_PATH}/posts`;
    const items = await ghListDir(postsDir);
    const posts = [];
    for (const it of items) {
      if (it.type !== "file" || !it.name.endsWith(".json")) continue;
      const { content } = await ghGet(`${postsDir}/${it.name}`);
      const p = JSON.parse(content);
      if (new Date(p.createdAt).getTime() >= cutoff) posts.push(p);
    }
    // sort newest first
    posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // attach counts
    for (const p of posts) {
      p.likes = await countBy("likes", "postId", p.id, cutoff);
      p.comments = await listBy("comments", "postId", p.id, cutoff);
      p.commentCount = p.comments.length;
    }
    res.json(posts);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

async function listBy(folder, key, value, cutoff) {
  const dir = `${BASE_PATH}/${folder}`;
  const items = await ghListDir(dir);
  const out = [];
  for (const it of items) {
    if (it.type !== "file" || !it.name.endsWith(".json")) continue;
    const { content } = await ghGet(`${dir}/${it.name}`);
    const obj = JSON.parse(content);
    if (obj[key] === value && new Date(obj.createdAt).getTime() >= cutoff) {
      out.push(obj);
    }
  }
  // sort oldest first for comments
  out.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return out;
}

async function countBy(folder, key, value, cutoff) {
  const arr = await listBy(folder, key, value, cutoff);
  return arr.length;
}

app.post("/api/posts", async (req, res) => {
  try {
    const { author, text, imageUrl } = req.body || {};
    if (!author || !text) return res.status(400).json({ error: "author and text required" });
    const id = uid();
    const post = { id, author, text, imageUrl: imageUrl || null, createdAt: nowISO() };
    await ghPut(`${BASE_PATH}/posts/${id}.json`, JSON.stringify(post, null, 2), `create post ${id}`);
    res.json(post);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/comments", async (req, res) => {
  try {
    const { postId, user, text } = req.body || {};
    if (!postId || !user || !text) return res.status(400).json({ error: "postId, user, text required" });
    const id = uid();
    const comment = { id, postId, user, text, createdAt: nowISO() };
    await ghPut(`${BASE_PATH}/comments/${id}.json`, JSON.stringify(comment, null, 2), `create comment ${id}`);
    res.json(comment);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/likes", async (req, res) => {
  try {
    const { postId, user } = req.body || {};
    if (!postId || !user) return res.status(400).json({ error: "postId and user required" });
    // prevent duplicate like within TTL by same user
    const cutoff = Date.now() - TTL_MS;
    const existing = await listBy("likes", "postId", postId, cutoff);
    const dup = existing.find(x => x.user === user);
    if (dup) return res.status(200).json({ ok: true, duplicate: true });
    const id = uid();
    const like = { id, postId, user, createdAt: nowISO() };
    await ghPut(`${BASE_PATH}/likes/${id}.json`, JSON.stringify(like, null, 2), `create like ${id}`);
    res.json(like);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Cleanup endpoint: deletes any files older than 24h
app.post("/api/cleanup", async (req, res) => {
  try {
    const cutoff = Date.now() - TTL_MS;
    const folders = ["posts", "comments", "likes"];
    let deleted = 0;
    for (const f of folders) {
      const dir = `${BASE_PATH}/${f}`;
      const items = await ghListDir(dir);
      for (const it of items) {
        if (it.type !== "file" || !it.name.endsWith(".json")) continue;
        const { content } = await ghGet(`${dir}/${it.name}`);
        const obj = JSON.parse(content);
        if (new Date(obj.createdAt).getTime() < cutoff) {
          await ghDelete(`${dir}/${it.name}`, `cleanup old ${f} ${it.name}`);
          deleted++;
        }
      }
    }
    res.json({ deleted });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ChillFeed running on http://localhost:${PORT}`));
