// TokenEditor component - contentEditable-based rich text editor with token insertion
// This is embedded in index.html via a script tag

const TokenEditor = ({ placeholder, onSubmit, submitLabel, onCancel, cancelLabel, autoFocus, tokens, isLoadingTokens }) => {
  const [showMenu, setShowMenu] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState(null);
  const [filter, setFilter] = React.useState('');
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [slashPosition, setSlashPosition] = React.useState(null);
  const editorRef = React.useRef(null);

  // Define categories with their colors
  const categories = [
    { id: 'colour', label: 'Colour tokens', color: '#8b5cf6', tokens: tokens.colors || [] },
    { id: 'text', label: 'Text tokens', color: '#3b82f6', tokens: tokens.typography || [] },
    { id: 'spacing', label: 'Spacing tokens', color: '#10b981', tokens: tokens.spacing || [] },
  ];

  // Parse token name into groups and display name
  // e.g., "Body/Bold/Body 4" -> { groups: ['Body', 'Bold'], displayName: 'Body 4' }
  // e.g., "Text/Primary" -> { groups: ['Text'], displayName: 'Primary' }
  // e.g., "Primary Blue" -> { groups: [], displayName: 'Primary Blue' }
  const parseTokenName = (token) => {
    const name = token.label || token.name || '';
    const parts = name.split('/');

    if (parts.length === 1) {
      return { groups: [], displayName: name };
    }

    // Last part is the display name, everything before are groups
    const displayName = parts[parts.length - 1];
    const groups = parts.slice(0, -1);

    return { groups, displayName };
  };

  // Group tokens with support for nested groups
  // Returns structure like:
  // [
  //   { group: 'Body', subgroups: [
  //     { subgroup: 'Bold', tokens: [...] },
  //     { subgroup: 'Regular', tokens: [...] }
  //   ]},
  //   { group: 'Heading', subgroups: [
  //     { subgroup: null, tokens: [...] }  // no subgroup
  //   ]},
  //   { group: null, tokens: [...] }  // ungrouped
  // ]
  const groupTokens = (tokenList) => {
    const groupMap = {};
    const ungrouped = [];

    tokenList.forEach(token => {
      const { groups } = parseTokenName(token);

      if (groups.length === 0) {
        ungrouped.push(token);
      } else if (groups.length === 1) {
        // Single level grouping
        const groupName = groups[0];
        if (!groupMap[groupName]) {
          groupMap[groupName] = { subgroups: {} };
        }
        if (!groupMap[groupName].subgroups['__none__']) {
          groupMap[groupName].subgroups['__none__'] = [];
        }
        groupMap[groupName].subgroups['__none__'].push(token);
      } else {
        // Multi-level grouping (use first two levels)
        const groupName = groups[0];
        const subgroupName = groups[1];
        if (!groupMap[groupName]) {
          groupMap[groupName] = { subgroups: {} };
        }
        if (!groupMap[groupName].subgroups[subgroupName]) {
          groupMap[groupName].subgroups[subgroupName] = [];
        }
        groupMap[groupName].subgroups[subgroupName].push(token);
      }
    });

    // Convert to array format
    const result = [];

    // Sort groups alphabetically
    Object.keys(groupMap).sort().forEach(groupName => {
      const group = groupMap[groupName];
      const subgroups = [];

      // Sort subgroups, but put __none__ first
      const subgroupNames = Object.keys(group.subgroups).sort((a, b) => {
        if (a === '__none__') return -1;
        if (b === '__none__') return 1;
        return a.localeCompare(b);
      });

      subgroupNames.forEach(subgroupName => {
        subgroups.push({
          subgroup: subgroupName === '__none__' ? null : subgroupName,
          tokens: group.subgroups[subgroupName]
        });
      });

      result.push({ group: groupName, subgroups });
    });

    // Add ungrouped tokens at the end
    if (ungrouped.length > 0) {
      result.push({ group: null, tokens: ungrouped });
    }

    return result;
  };

  // Get filtered tokens for current category
  const getFilteredTokens = () => {
    if (!activeCategory) return [];

    return activeCategory.tokens.filter(t => {
      const label = t.label || t.name || '';
      return label.toLowerCase().includes(filter.toLowerCase());
    });
  };

  // Get current items based on whether a category is selected
  const currentItems = activeCategory
    ? getFilteredTokens()
    : categories.filter(c => {
        // Only show categories that have tokens
        if (c.tokens.length === 0) return false;
        return c.label.toLowerCase().includes(filter.toLowerCase());
      });

  // Get grouped tokens for rendering
  const groupedTokens = activeCategory ? groupTokens(currentItems) : null;

  // Flatten grouped tokens for keyboard navigation
  const flattenedTokens = React.useMemo(() => {
    if (!groupedTokens) return [];
    const flat = [];
    groupedTokens.forEach(g => {
      if (g.tokens) {
        // Ungrouped tokens
        g.tokens.forEach(t => flat.push(t));
      } else if (g.subgroups) {
        // Grouped tokens with possible subgroups
        g.subgroups.forEach(sg => {
          sg.tokens.forEach(t => flat.push(t));
        });
      }
    });
    return flat;
  }, [groupedTokens]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [filter, activeCategory]);

  React.useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus();
    }
  }, [autoFocus]);

  const handleInput = (e) => {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const node = range.startContainer;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      const offset = range.startOffset;
      const charBefore = text[offset - 1];

      if (charBefore === '/') {
        setShowMenu(true);
        setActiveCategory(null);
        setFilter('');
        setSlashPosition({ node, offset: offset - 1 });
      } else if (showMenu && slashPosition) {
        const textAfterSlash = text.substring(slashPosition.offset + 1, offset);
        if (textAfterSlash.includes(' ') || offset <= slashPosition.offset) {
          setShowMenu(false);
          setActiveCategory(null);
          setFilter('');
        } else {
          setFilter(textAfterSlash);
        }
      }
    }
  };

  const handleKeyDown = (e) => {
    // Handle backspace to delete token tags
    if (e.key === 'Backspace' && !showMenu) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (range.collapsed) {
          const node = range.startContainer;
          const offset = range.startOffset;

          // Check if cursor is right after a token tag
          if (node.nodeType === Node.TEXT_NODE && offset === 0) {
            const prevSibling = node.previousSibling;
            if (prevSibling && prevSibling.classList?.contains('token-tag')) {
              e.preventDefault();
              prevSibling.remove();
              return;
            }
          }

          // Check if cursor is at start of editor and previous element is a tag
          if (node === editorRef.current && offset > 0) {
            const children = Array.from(editorRef.current.childNodes);
            const prevChild = children[offset - 1];
            if (prevChild && prevChild.classList?.contains('token-tag')) {
              e.preventDefault();
              prevChild.remove();
              return;
            }
          }

          // Check if we're in the editor directly and the previous node is a tag
          if (node.nodeType === Node.ELEMENT_NODE && node === editorRef.current) {
            const children = Array.from(node.childNodes);
            if (offset > 0) {
              const prevChild = children[offset - 1];
              if (prevChild && prevChild.classList?.contains('token-tag')) {
                e.preventDefault();
                prevChild.remove();
                return;
              }
            }
          }
        }
      }
    }

    if (!showMenu) {
      // Allow Cmd/Ctrl+Enter to submit
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
      return;
    }

    const itemCount = activeCategory ? flattenedTokens.length : currentItems.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev =>
        prev < itemCount - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev =>
        prev > 0 ? prev - 1 : itemCount - 1
      );
    } else if (e.key === 'Enter' && itemCount > 0) {
      e.preventDefault();
      if (activeCategory) {
        handleSelect(flattenedTokens[selectedIndex]);
      } else {
        handleSelect(currentItems[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (activeCategory) {
        // Go back to main menu
        setActiveCategory(null);
        setSelectedIndex(0);
        setFilter('');
      } else {
        setShowMenu(false);
      }
    } else if (e.key === 'Backspace' && activeCategory && filter === '') {
      // Go back to main menu when backspacing with empty filter
      e.preventDefault();
      setActiveCategory(null);
      setSelectedIndex(0);
    }
  };

  const handleSelect = (item) => {
    // First level - category selection
    if (!activeCategory && item.tokens) {
      setActiveCategory(item);
      setSelectedIndex(0);
      setFilter('');
      return;
    }

    // Second level - actual token selection
    insertToken(item, activeCategory);
  };

  const insertToken = (token, category) => {
    if (!slashPosition) return;

    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const node = slashPosition.node;
    const text = node.textContent;
    const cursorOffset = range.startOffset;

    const before = text.substring(0, slashPosition.offset);
    const after = text.substring(cursorOffset);

    // Use full token name for the tag
    const tokenName = token.label || token.name;
    const tagColor = category.color;

    // Build value string for tooltip based on token type
    let valueStr = '';
    if (category.id === 'colour') {
      valueStr = token.value || '';
    } else if (category.id === 'text') {
      const parts = [];
      if (token.fontFamily) parts.push(token.fontFamily);
      if (token.fontSize) parts.push(`${token.fontSize}px`);
      if (token.fontWeight) parts.push(`weight ${token.fontWeight}`);
      valueStr = parts.join(', ');
    } else if (category.id === 'spacing') {
      valueStr = token.value || '';
    }

    // Create the tag element
    const tag = document.createElement('span');
    tag.contentEditable = 'false';
    tag.className = 'token-tag';
    tag.dataset.type = category.id;
    tag.dataset.value = tokenName;
    tag.title = valueStr; // Show value on hover
    tag.style.cssText = `
      background-color: ${tagColor}20;
      color: ${tagColor};
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
      font-size: 12px;
      margin: 0 2px;
      display: inline-block;
      border: 1px solid ${tagColor}40;
    `;
    tag.textContent = tokenName;

    // Replace content
    const beforeNode = document.createTextNode(before);
    const afterNode = document.createTextNode(after || ' ');

    const parent = node.parentNode;
    parent.insertBefore(beforeNode, node);
    parent.insertBefore(tag, node);
    parent.insertBefore(afterNode, node);
    parent.removeChild(node);

    // Set cursor after tag
    const newRange = document.createRange();
    newRange.setStart(afterNode, afterNode.textContent.length > 0 ? 1 : 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    setShowMenu(false);
    setActiveCategory(null);
    setSlashPosition(null);
    editorRef.current.focus();
  };

  const handleSubmit = () => {
    if (!editorRef.current) return;
    const text = editorRef.current.innerText.trim();
    const html = editorRef.current.innerHTML.trim();
    if (text && onSubmit) {
      // Send both plain text and HTML so comments can display styled tokens
      onSubmit(text, html);
      editorRef.current.innerHTML = '';
    }
  };

  const handleCancel = () => {
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
    if (onCancel) {
      onCancel();
    }
  };

  // Render a single token item
  const renderTokenItem = (token, flatIndex) => {
    const isSelected = flatIndex === selectedIndex;
    const { displayName } = parseTokenName(token);

    if (activeCategory.id === 'colour') {
      return React.createElement('div', {
        key: token.id,
        className: `token-dropdown-item ${isSelected ? 'selected' : ''}`,
        onClick: () => handleSelect(token),
        onMouseEnter: () => setSelectedIndex(flatIndex)
      },
        React.createElement('span', {
          className: 'token-color-preview',
          style: { backgroundColor: token.value }
        }),
        React.createElement('span', { className: 'token-name' }, displayName),
        React.createElement('span', { className: 'token-value' }, token.value)
      );
    }

    if (activeCategory.id === 'text') {
      return React.createElement('div', {
        key: token.id,
        className: `token-dropdown-item ${isSelected ? 'selected' : ''}`,
        onClick: () => handleSelect(token),
        onMouseEnter: () => setSelectedIndex(flatIndex)
      },
        React.createElement('span', { className: 'token-name' }, displayName),
        React.createElement('div', { className: 'token-text-value' },
          token.fontSize && React.createElement('span', { className: 'token-text-size' }, `${token.fontSize}px`),
          token.fontFamily && React.createElement('span', { className: 'token-text-font' }, token.fontFamily)
        )
      );
    }

    if (activeCategory.id === 'spacing') {
      return React.createElement('div', {
        key: token.id,
        className: `token-dropdown-item ${isSelected ? 'selected' : ''}`,
        onClick: () => handleSelect(token),
        onMouseEnter: () => setSelectedIndex(flatIndex)
      },
        React.createElement('span', { className: 'token-name' }, displayName),
        React.createElement('span', { className: 'token-value' }, token.value)
      );
    }

    return null;
  };

  // Render category item (first level)
  const renderCategoryItem = (item, index) => {
    const isSelected = index === selectedIndex;
    return React.createElement('div', {
      key: item.id,
      className: `token-dropdown-item ${isSelected ? 'selected' : ''}`,
      onClick: () => handleSelect(item),
      onMouseEnter: () => setSelectedIndex(index)
    },
      React.createElement('span', {
        className: 'category-dot',
        style: { backgroundColor: item.color }
      }),
      React.createElement('span', { className: 'label' }, item.label),
      React.createElement('span', { className: 'category-count' }, `${item.tokens.length}`),
      React.createElement('span', { className: 'category-arrow' }, '→')
    );
  };

  // Render grouped tokens with nested subgroups
  const renderGroupedTokens = () => {
    if (!groupedTokens) return null;

    const elements = [];
    let flatIndex = 0;

    groupedTokens.forEach((group) => {
      if (group.tokens) {
        // Ungrouped tokens (no group header)
        group.tokens.forEach((token) => {
          elements.push(renderTokenItem(token, flatIndex));
          flatIndex++;
        });
      } else if (group.subgroups) {
        // Group with possible subgroups
        elements.push(
          React.createElement('div', {
            key: `group-${group.group}`,
            className: 'token-group-title'
          }, group.group)
        );

        group.subgroups.forEach((subgroup) => {
          // Add subgroup subtitle if it exists
          if (subgroup.subgroup) {
            elements.push(
              React.createElement('div', {
                key: `subgroup-${group.group}-${subgroup.subgroup}`,
                className: 'token-subgroup-title'
              }, subgroup.subgroup)
            );
          }

          // Add tokens in this subgroup
          subgroup.tokens.forEach((token) => {
            elements.push(renderTokenItem(token, flatIndex));
            flatIndex++;
          });
        });
      }
    });

    return elements;
  };

  return React.createElement('div', { className: 'token-editor-wrapper' },
    React.createElement('style', null, `
      .token-editor-wrapper [data-placeholder]:empty:before {
        content: attr(data-placeholder);
        color: #52525b;
        pointer-events: none;
      }
      .token-editor-wrapper .editor-content {
        width: 100%;
        min-height: 60px;
        max-height: 150px;
        overflow-y: auto;
        padding: 10px 12px;
        font-size: 13px;
        color: #e4e4e7;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        font-family: inherit;
        outline: none;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .token-editor-wrapper .editor-content:focus {
        border-color: #6366f1;
      }
      .token-editor-wrapper .category-dot {
        width: 12px;
        height: 12px;
        border-radius: 3px;
        flex-shrink: 0;
      }
      .token-editor-wrapper .category-count {
        color: #71717a;
        font-size: 11px;
        margin-left: auto;
      }
      .token-editor-wrapper .category-arrow {
        color: #71717a;
        font-size: 12px;
        margin-left: 8px;
      }
      .token-editor-wrapper .dropdown-header {
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .token-editor-wrapper .dropdown-back {
        border: none;
        background: none;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        color: #a1a1aa;
        font-size: 12px;
      }
      .token-editor-wrapper .dropdown-back:hover {
        background: rgba(255,255,255,0.1);
      }
      .token-editor-wrapper .dropdown-title {
        font-weight: 600;
        font-size: 12px;
      }
      .token-editor-wrapper .token-group-title {
        padding: 8px 12px 4px;
        font-size: 11px;
        font-weight: 600;
        color: #a1a1aa;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 4px;
        border-top: 1px solid rgba(255,255,255,0.05);
      }
      .token-editor-wrapper .token-group-title:first-child {
        margin-top: 0;
        border-top: none;
      }
      .token-editor-wrapper .token-subgroup-title {
        padding: 4px 12px 2px 20px;
        font-size: 10px;
        font-weight: 500;
        color: #71717a;
        letter-spacing: 0.3px;
      }
      .token-editor-wrapper .token-dropdown-item {
        padding-left: 20px;
      }
      .token-editor-wrapper .token-subgroup-title + .token-dropdown-item,
      .token-editor-wrapper .token-subgroup-title ~ .token-dropdown-item {
        padding-left: 28px;
      }
      .token-editor-wrapper .token-text-value {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        margin-left: auto;
      }
      .token-editor-wrapper .token-text-size {
        font-size: 12px;
        color: #a1a1aa;
        font-weight: 500;
      }
      .token-editor-wrapper .token-text-font {
        font-size: 10px;
        color: #71717a;
      }
      .token-editor-wrapper .token-loading {
        padding: 16px 12px;
        text-align: center;
        color: #71717a;
        font-size: 12px;
      }
      .token-editor-wrapper .token-loading-spinner {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.1);
        border-top-color: #6366f1;
        border-radius: 50%;
        animation: token-spin 0.8s linear infinite;
        margin-right: 8px;
        vertical-align: middle;
      }
      @keyframes token-spin {
        to { transform: rotate(360deg); }
      }
      .token-editor-wrapper .token-empty {
        padding: 16px 12px;
        text-align: center;
        color: #52525b;
        font-size: 12px;
      }
    `),
    React.createElement('div', { style: { position: 'relative' } },
      React.createElement('div', {
        ref: editorRef,
        contentEditable: true,
        className: 'editor-content',
        onInput: handleInput,
        onKeyDown: handleKeyDown,
        'data-placeholder': placeholder || 'Type here... Use / for tokens',
        suppressContentEditableWarning: true
      }),
      showMenu && React.createElement('div', {
        className: 'token-dropdown',
        onMouseDown: (e) => e.preventDefault()
      },
        // Show back button and category name when in a category
        activeCategory && React.createElement('div', { className: 'dropdown-header' },
          React.createElement('button', {
            className: 'dropdown-back',
            onClick: () => { setActiveCategory(null); setSelectedIndex(0); setFilter(''); }
          }, '← Back'),
          React.createElement('span', {
            className: 'dropdown-title',
            style: { color: activeCategory.color }
          }, activeCategory.label)
        ),
        // Show loading state
        isLoadingTokens && currentItems.length === 0 && !activeCategory && React.createElement('div', { className: 'token-loading' },
          React.createElement('span', { className: 'token-loading-spinner' }),
          'Loading tokens from Figma...'
        ),
        // Show empty state when not loading and no tokens
        !isLoadingTokens && currentItems.length === 0 && !activeCategory && React.createElement('div', { className: 'token-empty' },
          'No tokens available. Connect a Figma file to load design tokens.'
        ),
        // Show loading state within a category
        isLoadingTokens && activeCategory && flattenedTokens.length === 0 && React.createElement('div', { className: 'token-loading' },
          React.createElement('span', { className: 'token-loading-spinner' }),
          'Loading...'
        ),
        // Render categories or grouped tokens
        !activeCategory && currentItems.length > 0
          ? currentItems.map((item, index) => renderCategoryItem(item, index))
          : activeCategory && flattenedTokens.length > 0
            ? renderGroupedTokens()
            : null
      )
    ),
    React.createElement('div', { className: 'popup-actions' },
      React.createElement('button', {
        className: 'popup-btn cancel',
        onClick: handleCancel
      }, cancelLabel || 'Cancel'),
      React.createElement('button', {
        className: 'popup-btn submit',
        onClick: handleSubmit
      }, submitLabel || 'Submit')
    )
  );
};

// Make it available globally
window.TokenEditor = TokenEditor;
