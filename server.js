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

// Helper function to recursively collect style usage with their color/text values
function collectStyleValues(node, styleValues = { fills: {}, texts: {} }) {
  if (!node) return styleValues;

  // Collect fill color value for nodes with fill styles
  if (node.styles?.fill && node.fills && Array.isArray(node.fills)) {
    const styleId = node.styles.fill;
    if (!styleValues.fills[styleId]) {
      const solidFill = node.fills.find(f => f.type === 'SOLID' && f.color && f.visible !== false);
      if (solidFill) {
        const r = Math.round(solidFill.color.r * 255);
        const g = Math.round(solidFill.color.g * 255);
        const b = Math.round(solidFill.color.b * 255);
        const hex = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
        styleValues.fills[styleId] = hex;
      }
    }
  }

  // Collect text style properties for nodes with text styles
  if (node.styles?.text && node.style) {
    const styleId = node.styles.text;
    if (!styleValues.texts[styleId]) {
      styleValues.texts[styleId] = {
        fontSize: node.style.fontSize,
        fontFamily: node.style.fontFamily,
        fontWeight: node.style.fontWeight,
        lineHeight: node.style.lineHeightPx,
        letterSpacing: node.style.letterSpacing,
      };
    }
  }

  // Recursively process children
  if (node.children && Array.isArray(node.children)) {
    node.children.forEach(child => collectStyleValues(child, styleValues));
  }

  return styleValues;
}

// Fetch Figma styles (colors and typography) - local styles + connected libraries
app.get('/api/figma/styles/:fileKey', async (req, res) => {
  const { fileKey } = req.params;
  const figmaToken = req.headers['x-figma-token'];

  if (!figmaToken) {
    return res.status(401).json({ error: 'Figma token required' });
  }

  try {
    // Fetch full file to get local styles and their usage
    const fileResponse = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
      headers: { 'X-Figma-Token': figmaToken }
    });

    const fileData = await fileResponse.json();

    if (!fileResponse.ok) {
      return res.status(fileResponse.status).json(fileData);
    }

    const styles = { colors: [], typography: [] };

    // Collect actual color/text values from nodes that use styles
    const styleValues = { fills: {}, texts: {} };
    if (fileData.document) {
      collectStyleValues(fileData.document, styleValues);
    }

    // Process local styles from the file (data.styles contains both local and external)
    if (fileData.styles) {
      Object.entries(fileData.styles).forEach(([styleId, style]) => {
        if (style.styleType === 'FILL') {
          const colorValue = styleValues.fills[styleId];
          // Only include if we found the color value in the document
          if (colorValue) {
            styles.colors.push({
              id: styleId,
              name: style.name,
              value: colorValue,
              description: style.description || '',
            });
          }
        } else if (style.styleType === 'TEXT') {
          const textProps = styleValues.texts[styleId] || {};
          styles.typography.push({
            id: styleId,
            name: style.name,
            fontSize: textProps.fontSize,
            fontFamily: textProps.fontFamily,
            fontWeight: textProps.fontWeight,
            lineHeight: textProps.lineHeight,
            letterSpacing: textProps.letterSpacing,
            description: style.description || '',
          });
        }
      });
    }

    // For colors without values found in document, try to fetch from style nodes
    // This handles styles that exist but aren't actively used in the visible document
    const colorsWithoutValues = Object.entries(fileData.styles || {})
      .filter(([id, s]) => s.styleType === 'FILL' && !styleValues.fills[id])
      .map(([id, s]) => ({ id, name: s.name, description: s.description }));

    if (colorsWithoutValues.length > 0) {
      // Fetch the style node details to get color values
      const nodeIds = colorsWithoutValues.map(c => c.id).join(',');
      try {
        const nodesResponse = await fetch(
          `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeIds)}`,
          { headers: { 'X-Figma-Token': figmaToken } }
        );
        const nodesData = await nodesResponse.json();

        if (nodesResponse.ok && nodesData.nodes) {
          colorsWithoutValues.forEach(colorStyle => {
            const nodeData = nodesData.nodes[colorStyle.id];
            if (nodeData?.document?.fills) {
              const solidFill = nodeData.document.fills.find(f => f.type === 'SOLID' && f.color);
              if (solidFill) {
                const r = Math.round(solidFill.color.r * 255);
                const g = Math.round(solidFill.color.g * 255);
                const b = Math.round(solidFill.color.b * 255);
                const hex = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
                styles.colors.push({
                  id: colorStyle.id,
                  name: colorStyle.name,
                  value: hex,
                  description: colorStyle.description || '',
                });
              }
            }
          });
        }
      } catch (e) {
        console.warn('Could not fetch additional style nodes:', e.message);
      }
    }

    // Sort alphabetically by name
    styles.colors.sort((a, b) => a.name.localeCompare(b.name));
    styles.typography.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`Fetched ${styles.colors.length} colors and ${styles.typography.length} text styles from Figma`);

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
