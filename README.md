# DesignQA

A design comparison tool for QA. Upload production screenshots, fetch designs from Figma, and leave comments to track differences.

![DesignQA Screenshot](https://via.placeholder.com/800x400?text=DesignQA+Screenshot)

## Features

- **Side-by-side comparison**: Production screenshot vs Figma design
- **Figma integration**: Paste any Figma link to fetch the design
- **Pin comments**: Click anywhere on the production image to leave feedback
- **Resolve/delete comments**: Track what's been fixed
- **Remember token**: Stay connected to Figma across sessions

## Deploy to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/design-qa.git
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app)
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `design-qa` repository
4. Railway auto-detects Node.js and deploys

That's it! Railway will give you a URL like `design-qa-production.up.railway.app`

### 3. (Optional) Custom Domain

In Railway dashboard:
1. Go to your project → **Settings** → **Domains**
2. Add your custom domain
3. Update DNS records as instructed

## Local Development

```bash
# Install dependencies
npm install

# Run the server
npm start

# Open http://localhost:3000
```

## How It Works

The app has a simple Express backend that proxies requests to Figma's API. This is needed because Figma's API blocks direct browser requests (CORS).

```
Browser → /api/figma/images/:fileKey → Figma API → Image URL
```

User tokens are stored in the browser's localStorage (never on the server).

## Tech Stack

- **Frontend**: React (via CDN, no build step)
- **Backend**: Express.js
- **Hosting**: Railway
- **API**: Figma REST API

## Project Structure

```
design-qa/
├── server.js          # Express server + Figma proxy
├── package.json       # Dependencies
├── public/
│   └── index.html     # React app (single file)
└── README.md
```

## License

MIT
