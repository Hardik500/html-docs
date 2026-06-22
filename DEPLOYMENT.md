# Deployment Guide

This app is a full-stack Node.js SSR application (React Router 7) with PostgreSQL. Choose a platform designed for Node.js apps.

## Recommendation Matrix

| Platform | Cost | Effort | Downtime | Best For |
|----------|------|--------|----------|----------|
| **Fly.io** | $3-5/mo | 0 min | None | Keep current setup |
| **Railway** | $5-10/mo | 10 min | ~1 min | Easy migration |
| **Render** | $0-15/mo | 15 min | ~1 min | Free tier users |
| **Heroku** | $15+/mo | 15 min | ~2 min | Mature ecosystem |

---

## Fly.io (⭐ Recommended - Keep current)

### Setup
1. **Enable billing** on your Fly.io account
2. **No code changes needed** - already configured in `fly.toml`

### Why Fly.io is best:
- ✅ **Cheapest** - $3-5/month for your workload
- ✅ **Zero effort** - Already set up and working
- ✅ **Proven** - Currently deployed and tested
- ✅ **No downtime** - Just enable billing

**Recommendation**: Unless you have a specific reason to move, keeping Fly.io is the pragmatic choice.

---

## Railway (Easiest migration)

### Setup
1. Go to [railway.app](https://railway.app)
2. **Connect your GitHub repo**
3. **Railway auto-detects:**
   - Build command: `npm run build`
   - Start command: `npm start`
4. **Set environment variables:**
   ```
   DATABASE_URL=postgresql://...
   SUPABASE_URL=https://...
   SUPABASE_ANON_KEY=...
   APP_URL=https://your-railway-app.up.railway.app
   IP_HASH_SALT=...
   NODE_ENV=production
   ```

5. **Deploy** - automatic on every Git push

### Notes
- **Cost**: $5-10/month depending on usage
- **Effort**: ~10 minutes to set up
- **Downtime**: ~1 minute while deploying
- **Migration**: Remove `fly.toml` and Railway takes over

---

## Render (Free tier available)

### Setup
1. Go to [render.com](https://render.com)
2. **New Web Service** → Connect GitHub repo
3. **Build command**: `npm run build`
4. **Start command**: `npm start`
5. **Environment variables**: Same as Railway
6. **Deploy**

### Notes
- **Cost**: Free tier with 750 free compute hours/month (sufficient for hobby projects)
- **Limitation**: Free tier spins down after 15 minutes of inactivity (~5 second cold start)
- **Upside**: No credit card required for free tier

---

## Vercel (⚠️ Not recommended)

Vercel is optimized for serverless APIs and static sites, not full Node.js SSR apps. It would require significant refactoring:
- 60-second function timeout (can be exceeded)
- 500ms+ cold starts after inactivity
- Complex setup needed for stateful connections

**Skip this unless you have specific reasons.**

---

## Docker Deployment (DIY)

Deploy to any Docker-compatible platform:
- AWS ECS
- Google Cloud Run
- Azure Container Apps
- DigitalOcean App Platform

```bash
docker build -t html-docs .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e SUPABASE_URL=https://... \
  -e SUPABASE_ANON_KEY=... \
  -e APP_URL=https://your-domain.com \
  -e IP_HASH_SALT=... \
  html-docs
```

---

## Database Migrations

For Railway/Render, migrations run automatically on startup via `db/migrate.js`. The script:
1. Checks for already-applied migrations
2. Runs pending migrations
3. Skips already-applied ones

No manual setup needed.
