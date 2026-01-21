const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Figma API proxy endpoint - bypasses CORS
app.get('/api/figma/images/:fileKey', async (req, res) => {
  const { fileKey } = req.params;
  const { ids, format = 'png', scale = '2' } = req.query;
  const figmaToken = req.headers['x-figma-token'];

  if (!figmaToken) {
    return res.status(401).json({ error: 'Figma token required' });
  }

  if (!ids) {
    return res.status(400).json({ error: 'Node IDs required' });
  }

  try {
    const figmaUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${ids}&format=${format}&scale=${scale}`;
    
    const response = await fetch(figmaUrl, {
      headers: {
        'X-Figma-Token': figmaToken
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Figma API error:', error);
    res.status(500).json({ error: 'Failed to fetch from Figma' });
  }
});

// Figma file info endpoint (optional - for getting file name, etc.)
app.get('/api/figma/files/:fileKey', async (req, res) => {
  const { fileKey } = req.params;
  const figmaToken = req.headers['x-figma-token'];

  if (!figmaToken) {
    return res.status(401).json({ error: 'Figma token required' });
  }

  try {
    const response = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=1`, {
      headers: {
        'X-Figma-Token': figmaToken
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Figma API error:', error);
    res.status(500).json({ error: 'Failed to fetch from Figma' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Design QA server running on port ${PORT}`);
});
