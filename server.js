const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple file-backed "database" for sessions
const DB_FILE = path.join(__dirname, 'data.json');

let db = { sessions: [] };

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(raw || '{"sessions":[]}');
      if (!Array.isArray(db.sessions)) {
        db.sessions = [];
      }
    }
  } catch (err) {
    console.error('Failed to load database file, starting with empty DB.', err);
    db = { sessions: [] };
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save database file.', err);
  }
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

loadDb();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
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

// Simple session storage API
// Shape:
// {
//   id?: string;
//   prodImage: string | null;
//   designImage: string | null;
//   figmaUrl: string;
//   comments: Array<{ id: number; x: number; y: number; text: string; resolved: boolean }>
// }

// Create or update a session
app.post('/api/sessions', (req, res) => {
  const { id, prodImage, designImage, figmaUrl, comments } = req.body || {};

  if (!prodImage && !designImage && !figmaUrl && (!Array.isArray(comments) || comments.length === 0)) {
    return res.status(400).json({ error: 'Nothing to save. Provide at least one of prodImage, designImage, figmaUrl, or comments.' });
  }

  const now = new Date().toISOString();
  let session;

  if (id) {
    const existingIndex = db.sessions.findIndex((s) => s.id === id);
    if (existingIndex === -1) {
      return res.status(404).json({ error: 'Session not found for update.' });
    }

    session = {
      ...db.sessions[existingIndex],
      prodImage: typeof prodImage !== 'undefined' ? prodImage : db.sessions[existingIndex].prodImage,
      designImage: typeof designImage !== 'undefined' ? designImage : db.sessions[existingIndex].designImage,
      figmaUrl: typeof figmaUrl !== 'undefined' ? figmaUrl : db.sessions[existingIndex].figmaUrl,
      comments: Array.isArray(comments) ? comments : db.sessions[existingIndex].comments,
      updatedAt: now,
    };

    db.sessions[existingIndex] = session;
  } else {
    const newId = generateId();
    session = {
      id: newId,
      prodImage: prodImage || null,
      designImage: designImage || null,
      figmaUrl: figmaUrl || '',
      comments: Array.isArray(comments) ? comments : [],
      createdAt: now,
      updatedAt: now,
    };
    db.sessions.push(session);
  }

  saveDb();

  res.json({ id: session.id, session });
});

// Get a single session
app.get('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  const session = db.sessions.find((s) => s.id === id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  res.json({ session });
});

// (Optional) list sessions - useful for debugging / admin
app.get('/api/sessions', (req, res) => {
  res.json({
    sessions: db.sessions.map(({ id, createdAt, updatedAt }) => ({
      id,
      createdAt,
      updatedAt,
    })),
  });
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

// Helper function to recursively extract styles from Figma document
function extractStyles(node, styles = { colors: [], typography: [] }) {
  if (!node) return styles;

  // Extract color styles (PAINT fills)
  if (node.fills && Array.isArray(node.fills)) {
    node.fills.forEach(fill => {
      if (fill.type === 'SOLID' && fill.color) {
        const colorStyle = node.styles?.fill || node.fillStyleId;
        if (colorStyle) {
          const existing = styles.colors.find(c => c.id === colorStyle);
          if (!existing) {
            const r = Math.round(fill.color.r * 255);
            const g = Math.round(fill.color.g * 255);
            const b = Math.round(fill.color.b * 255);
            const a = fill.opacity !== undefined ? fill.opacity : fill.color.a || 1;
            const hex = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
            styles.colors.push({
              id: colorStyle,
              name: colorStyle.split('/').pop() || 'Untitled Color',
              value: hex,
              rgba: `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`,
            });
          }
        }
      }
    });
  }

  // Extract typography styles
  if (node.style) {
    const textStyle = node.styleId || node.textStyleId;
    if (textStyle) {
      const existing = styles.typography.find(t => t.id === textStyle);
      if (!existing && node.style) {
        styles.typography.push({
          id: textStyle,
          name: textStyle.split('/').pop() || 'Untitled Text',
          fontSize: node.style.fontSize,
          fontFamily: node.style.fontFamily,
          fontWeight: node.style.fontWeight,
          lineHeight: node.style.lineHeightPx,
          letterSpacing: node.style.letterSpacing,
        });
      }
    }
  }

  // Recursively process children
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => extractStyles(child, styles));
  }

  return styles;
}

// Fetch Figma styles (colors and typography)
app.get('/api/figma/styles/:fileKey', async (req, res) => {
  const { fileKey } = req.params;
  const figmaToken = req.headers['x-figma-token'];

  if (!figmaToken) {
    return res.status(401).json({ error: 'Figma token required' });
  }

  try {
    // Fetch full file with all nodes to extract styles
    const response = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
      headers: {
        'X-Figma-Token': figmaToken
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    // Extract styles from the document
    const styles = { colors: [], typography: [] };
    if (data.document) {
      extractStyles(data.document, styles);
    }

    // Also try to get styles from the styles object if available
    if (data.styles) {
      Object.entries(data.styles).forEach(([styleId, style]) => {
        if (style.styleType === 'FILL') {
          // This would require another API call to get the actual color value
          // For now, we'll rely on extracting from nodes
        } else if (style.styleType === 'TEXT') {
          const existing = styles.typography.find(t => t.id === styleId);
          if (!existing) {
            styles.typography.push({
              id: styleId,
              name: style.name || styleId.split('/').pop(),
              description: style.description,
            });
          }
        }
      });
    }

    // Remove duplicates and sort
    styles.colors = Array.from(new Map(styles.colors.map(c => [c.id, c])).values())
      .sort((a, b) => a.name.localeCompare(b.name));
    styles.typography = Array.from(new Map(styles.typography.map(t => [t.id, t])).values())
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(styles);
  } catch (error) {
    console.error('Figma styles API error:', error);
    res.status(500).json({ error: 'Failed to fetch styles from Figma' });
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
