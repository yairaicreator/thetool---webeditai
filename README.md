# WebEdit AI Chrome Extension

A Chrome extension that lets you visually edit any website – hide elements, customize styles, or add new elements.

## 🚀 Features

- **Remove/Hide**: Click to hide any element on a webpage
- **Customize**: Change background color, text color, and font size of elements
- **Add**: Insert new styled elements (double-click the gradient button when in Add mode)
- **Visual Element Picker**: Hover and click to select elements with visual feedback

## 📁 Project Structure

```
webedit-extension/
├── manifest.json          # Extension configuration
├── popup.html            # Popup UI structure
├── popup.css             # Popup styling
├── popup.js              # Popup logic and event handlers
├── contentScript.js      # Content script for page manipulation
├── contentStyles.css     # Styles injected into web pages
└── Logo/                 # Extension icons
    ├── favicon16.png
    ├── favicon32.png
    ├── favicon48.png
    └── favicon128.png
```

## 🔧 Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select this folder (`C:\dev\thetool---webeditai-1`)
5. The WebEdit AI extension should now appear in your extensions list
6. Pin the extension to your toolbar for easy access

## 🎯 How to Use

### Basic Workflow

1. **Open the extension** on any webpage
2. **Choose a tool** from the three options:
   - Remove/hide (default)
   - Customize
   - Add
3. **Click "Pick element"**
4. **Hover over elements** on the page (they'll highlight in blue)
5. **Click an element** to apply your chosen action

### Remove/Hide Mode

- Select an element and it will immediately be hidden
- Perfect for removing ads, popups, or unwanted content

### Customize Mode

- After selecting an element, use the customization panel to:
  - Change **background color** (color picker)
  - Change **text color** (color picker)
  - Adjust **font size** (8-72px)
- Click **Apply** to save changes
- Click **Reset** to remove all custom styles

### Add Mode

- Select an element as a reference point
- Double-click the **"What do you want to change?"** button
- A new styled element will be inserted after your selection

### Additional Features

- **History** button: Placeholder for future edit history feature
- **Sign in** button: Placeholder for future authentication
- **Question button**: Shows help information about using the extension

## 🛠️ Technical Details

### Permissions

- `activeTab`: Access the currently active tab
- `scripting`: Inject scripts into web pages
- `<all_urls>`: Work on any website

### Content Scripts

The extension automatically injects:
- `contentScript.js`: Element selection and manipulation logic
- `contentStyles.css`: Visual feedback styles (hover highlights, selection outlines)

### Message Passing

The popup and content script communicate via Chrome's message passing API:
- `WEBEDIT_START_PICK`: Start element picking mode
- `WEBEDIT_ELEMENT_SELECTED`: Element has been selected
- `WEBEDIT_APPLY_STYLES`: Apply custom styles to element
- `WEBEDIT_RESET_STYLES`: Remove custom styles from element
- `WEBEDIT_ADD_ELEMENT`: Insert new element

## 🔮 Future Enhancements

- **Supabase Integration**: Store edits in the cloud
- **User Authentication**: Sign in with OAuth
- **Edit History**: View and restore previous edits
- **AI-Powered Editing**: Natural language commands
- **Sync Across Devices**: Access your edits anywhere
- **Advanced Add Tool**: Rich text editor and component library

## 🎨 Design

The extension features a modern UI with:
- Gradient accents (blue to pink)
- Light cyan background
- Clean, minimal design
- Smooth interactions
- Mobile-first responsive principles

## 📝 Development Notes

- All edits are currently local (not persisted)
- Refreshing the page will clear all changes
- Each edited element gets a unique `data-webedit-id` attribute
- The floating label follows your cursor during element picking

## 🐛 Known Limitations

- Edits are not saved between page refreshes
- Some complex web applications may interfere with element picking
- Very dynamic content (SPAs) may lose edits after navigation

## 📄 License

This is an initial development version. License to be determined.

