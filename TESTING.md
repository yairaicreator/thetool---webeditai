# WebEdit AI - Testing Guide

Quick guide to test all features of the refactored in-page chat panel.

## 🔄 Reload the Extension

After making changes:

1. Go to `chrome://extensions`
2. Find **WebEdit AI**
3. Click the **refresh icon** (🔄)
4. Refresh any tabs where you want to test

## ✅ Test Checklist

### 1. Panel Toggle

- [ ] Click extension icon in toolbar
- [ ] Click "Open WebEdit AI Panel" button
- [ ] Panel slides in from right side
- [ ] Page content shifts left (not overlaid)
- [ ] Click **×** button to close
- [ ] Panel slides out smoothly
- [ ] Page content returns to normal width

### 2. Visual Elements

- [ ] Header has blue-to-pink gradient
- [ ] "WebEdit AI" logo is visible
- [ ] "History" and "Sign in" buttons are clickable
- [ ] Welcome message shows with suggestion chips
- [ ] Bottom input bar has orange-to-indigo gradient
- [ ] Send button (paper plane icon) is visible

### 3. Chat Functionality

**Basic Chat:**
- [ ] Type "hello" and press Enter or click send
- [ ] User message appears on right (white bubble)
- [ ] AI response appears on left (gradient bubble)
- [ ] Welcome message disappears after first message

**Smart Responses:**
- [ ] Type "hide an element" → AI suggests remove tool
- [ ] Type "change color" → AI suggests customize tool + panel shows
- [ ] Type "add new content" → AI suggests add tool
- [ ] Verify AI auto-selects the correct tool in menu

**Suggestion Chips:**
- [ ] Click "Hide an element" chip → sends message
- [ ] Click "Customize styles" chip → sends message
- [ ] Click "Add content" chip → sends message

### 4. Visual Edit Menu

- [ ] Click hamburger button (☰)
- [ ] Dropdown menu appears with 3 options
- [ ] "Remove / hide" has active state by default
- [ ] Click "Customize" → becomes active
- [ ] Click "Add" → becomes active
- [ ] Menu closes when clicking outside
- [ ] Menu closes after selecting an option

### 5. Element Picking - Remove Mode

- [ ] Select "Remove / hide" from menu
- [ ] Click "Pick element" button
- [ ] AI confirms picker is active in chat
- [ ] Hover over page elements → blue outline appears
- [ ] Floating "WebEdit AI" label follows cursor
- [ ] Click an element → it disappears
- [ ] AI confirms "Element hidden successfully!"
- [ ] Picker automatically turns off

### 6. Element Picking - Customize Mode

- [ ] Select "Customize" from menu
- [ ] Click "Pick element" button
- [ ] Hover over page elements → blue outline appears
- [ ] Click an element → pink outline appears
- [ ] Customization panel appears above chat
- [ ] Status text updates: "Element selected..."
- [ ] AI message appears in chat

**Customization Controls:**
- [ ] Click background color picker → change color
- [ ] Click text color picker → change color
- [ ] Enter font size (e.g., 24)
- [ ] Click **Apply** button
- [ ] Styles apply to selected element
- [ ] AI confirms "Styles applied successfully!"
- [ ] Click **Reset** button
- [ ] Styles return to original
- [ ] AI confirms "Styles reset to default"

### 7. Element Picking - Add Mode

- [ ] Select "Add" from menu
- [ ] Click "Pick element" button
- [ ] Click an element on the page
- [ ] New orange pill appears after the element
- [ ] Text reads "New element from WebEdit AI"
- [ ] AI confirms "New element added!"
- [ ] Can now customize the new element

### 8. Safety Features

- [ ] Try to pick the panel itself → doesn't work
- [ ] Try to pick panel's children → doesn't work
- [ ] Try to pick `<html>` or `<body>` → picker ignores it
- [ ] Panel stays on top (z-index working)

### 9. Modal Dialogs

- [ ] Click "History" button → modal appears
- [ ] Modal says "coming soon"
- [ ] Click "Close" → modal disappears
- [ ] Click "Sign in" button → modal appears
- [ ] Click backdrop → modal closes

### 10. Responsive Behavior

- [ ] Resize browser window
- [ ] Panel stays fixed to right
- [ ] Panel height always matches viewport
- [ ] Scrollbar appears in chat when needed
- [ ] Page content adjusts with window size

### 11. Multiple Actions

- [ ] Hide 3 different elements
- [ ] Customize 2 different elements
- [ ] Add 2 new elements
- [ ] All chat messages appear correctly
- [ ] Can toggle panel closed and reopen
- [ ] Previous edits persist while panel open

## 🐛 Common Issues & Fixes

### "Please refresh the page first"

**Issue:** Content script not loaded yet  
**Fix:** Refresh the page after installing/updating extension

### Panel doesn't appear

**Issue:** Extension not loaded or page was loaded before extension  
**Fix:** 
1. Check `chrome://extensions` - ensure extension is enabled
2. Refresh the page
3. Try clicking icon again

### Page content not shifting left

**Issue:** CSS not applying to body  
**Fix:** Check browser console for errors, refresh page

### Can't pick elements

**Issue:** Event listeners not attached  
**Fix:** Close and reopen panel, or refresh page

### Styles not applying

**Issue:** Element selection lost  
**Fix:** Re-pick the element and try again

## 🎯 Test Scenarios

### Scenario 1: Remove Cookie Banner

1. Open extension on a site with a cookie banner
2. Type "hide the cookie banner" in chat
3. AI guides you through steps
4. Click pick element
5. Click the cookie banner
6. Verify it disappears

### Scenario 2: Customize Navigation

1. Type "I want to change the header color"
2. AI selects customize tool
3. Pick the header element
4. Change background to red (#ff0000)
5. Change text color to white (#ffffff)
6. Click Apply
7. Verify styles applied

### Scenario 3: Add CTA Button

1. Type "add a new button"
2. AI selects add tool
3. Pick where to insert (any element)
4. New orange pill appears
5. Switch to customize mode
6. Pick the new element
7. Customize its appearance

### Scenario 4: Complex Editing

1. Hide 2 unwanted elements
2. Customize 2 elements with different colors
3. Add 1 new element
4. Verify all 5 actions worked correctly
5. Check chat history shows all messages
6. Close and reopen panel
7. Verify page edits persist (until refresh)

## 📊 Performance Checks

- [ ] Panel opens in < 300ms
- [ ] Smooth 60fps animations
- [ ] No console errors
- [ ] No memory leaks (check DevTools)
- [ ] Works on heavy pages (e.g., YouTube, Reddit)
- [ ] Works on simple pages (e.g., Wikipedia)

## 🌐 Browser Compatibility

Test on different sites:
- [ ] Static site (e.g., blog)
- [ ] SPA (e.g., Gmail, Twitter)
- [ ] E-commerce (e.g., Amazon)
- [ ] Media site (e.g., YouTube)
- [ ] Documentation (e.g., MDN)

## ✨ Edge Cases

- [ ] Open multiple tabs → panel works independently
- [ ] Navigate to new page → panel persists
- [ ] Very long chat → scrolling works
- [ ] Rapidly toggle panel → no glitches
- [ ] Type very long message → wraps correctly
- [ ] Customize element with existing inline styles → overrides work

---

**Found a bug?** Check browser console, note reproduction steps, and document in GitHub issues.

