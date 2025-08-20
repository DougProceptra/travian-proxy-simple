# Travian Proxy Simple

A clean, simple proxy for the Anthropic API that actually works with Vercel.

## What This Is

This is a CORS proxy that allows your Chrome extension to call the Anthropic (Claude) API without exposing your API key in the extension.

## Deploy to Vercel

### Option 1: Deploy with Vercel Button
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/DougProceptra/travian-proxy-simple)

### Option 2: Deploy from GitHub
1. Go to [Vercel](https://vercel.com)
2. Click "New Project"
3. Import `DougProceptra/travian-proxy-simple`
4. Deploy

### Option 3: Deploy with CLI
```bash
git clone https://github.com/DougProceptra/travian-proxy-simple.git
cd travian-proxy-simple
npx vercel
```

## Configuration

After deployment, add your Anthropic API key:

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add: `ANTHROPIC_API_KEY` with your API key value
4. Redeploy for changes to take effect

## Test Your Deployment

```bash
curl -X POST https://your-deployment.vercel.app/api/anthropic \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 50
  }'
```

## Use in Chrome Extension

Update your extension's background service to use your deployment URL:

```javascript
const PROXY_URL = 'https://your-deployment.vercel.app/api/anthropic';
```

## Why This Works

- **Simple structure**: Just `/api/anthropic.js` and `package.json`
- **No monorepo**: Vercel properly detects the function
- **Edge runtime**: Fast and efficient
- **CORS enabled**: Works with browser extensions

## Files

- `/api/anthropic.js` - The proxy function
- `/package.json` - Simple package file
- `/README.md` - This file

That's it. No bullshit, just works.
