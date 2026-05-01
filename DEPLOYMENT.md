# HEALOSBENCH Deployment Guide

This guide explains how to deploy the HEALOSBENCH evaluation harness.

## Prerequisites
- A GitHub account.
- A [Vercel](https://vercel.com/) account (for the Frontend).
- A [Railway](https://railway.app/) account (for the Backend).

---

## 1. Push to GitHub
If you haven't already, initialize a git repository and push your code to GitHub.

```bash
git init
git add .
git commit -m "Prepare for deployment"
git remote add origin <your-repo-url>
git push -u origin main
```

---

## 2. Deploy the Backend (Railway)
1. Log in to [Railway](https://railway.app/).
2. Click **New Project** > **Deploy from GitHub repo**.
3. Select your repository.
4. Railway will use the `railway.json` file in the root to build the server.
5. **Add a Volume (Storage):**
   - Go to your service's **Settings**.
   - Click **Volumes** > **Add Volume**.
   - Mount it at `/data`.
6. **Set Environment Variables:**
   - `DATABASE_URL`: `file:/data/healosbench.db`
   - `BETTER_AUTH_SECRET`: (Generate a random string)
   - `BETTER_AUTH_URL`: (Your Railway app URL)
   - `CORS_ORIGIN`: (Your Vercel app URL - set this *after* deploying Vercel)
   - `NODE_ENV`: `production`

> [!TIP]
> To include the initial sample data, you can upload your `healosbench.db` to the `/data` volume using the Railway CLI or by running a script to seed the database.

---

## 3. Deploy the Frontend (Vercel)
1. Log in to [Vercel](https://vercel.com/).
2. Click **Add New** > **Project**.
3. Import your GitHub repository.
4. **Configure Project:**
   - **Root Directory:** `apps/web`
   - **Build Command:** `bun run build`
   - **Install Command:** `bun install`
5. **Set Environment Variables:**
   - `NEXT_PUBLIC_API_URL`: (The URL of your Railway backend, e.g., `https://server-production-xxx.up.railway.app`)
   - `BETTER_AUTH_URL`: (Your Vercel app URL)
   - `NODE_ENV`: `production`

---

## 4. Final Connection
Once both are deployed:
1. Update the `CORS_ORIGIN` in Railway to match your Vercel URL.
2. Update the `BETTER_AUTH_URL` in both to match their respective public URLs.
3. Your live demo should now be functional!
