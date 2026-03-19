# WebEdit AI Chrome Extension

A Chrome extension that injects an AI-powered side panel into any webpage, with chat history, account syncing, and placeholder feature controls.

## 🚀 Features

- **In-Page AI Chat Panel**: Sider-style right-side panel that pushes content left
- **Panel Chat UI**: Keep conversation history inside the side panel
- **Feature Buttons**: `Remove`, `Customize`, and `Add` remain visible as placeholder controls
- **Smart AI Responses**: Context-aware suggestions based on your requests

## 📁 Project Structure

```
webedit-extension/
├── manifest.json          # Extension configuration (v0.2.0)
├── popup.html            # Simple toggle popup
├── popup.js              # Popup toggle logic
├── contentScript.js      # Main panel injection & management
├── contentStyles.css     # Element picking visual feedback
├── panel.css             # Chat panel styling
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

### Opening the Panel

1. **Click the WebEdit AI extension icon** in your toolbar
2. The panel appears **instantly** - no popup, no extra steps!
3. Click the icon again to close the panel
4. The centered chat panel floats over the page

### Basic Workflow

1. **Open the side panel** from the extension icon
2. **Use the chat area** to keep notes and conversation history
3. **Use the three buttons** to switch the visible placeholder state:
   - Remove
   - Customize
   - Add

### Chat Features

- **Suggestion Chips**: Quick-start actions for common tasks
- **Smart Responses**: Supporting integrations remain in the codebase for future reconnect
- **Conversation History**: See all your interactions in the chat thread
- **Visual Feedback**: The selected placeholder button is highlighted in the panel

### Current Status

- `Remove`, `Customize`, and `Add` are visual-only controls
- Feature execution logic has been removed from the live panel
- Supabase and API integrations remain in the project but are not wired to those three features

### Panel Controls

- **History** button: Placeholder for future edit history feature
- **Sign in** button: Placeholder for future authentication
- **Close (×)**: Close the panel and restore normal page width

## 💡 Example Conversations

**User:** "I want to hide the cookie banner"
**AI:** "Feature execution is currently unavailable. The Remove, Customize, and Add buttons are visual-only right now."

**User:** "Change the color of the header"
**AI:** "Feature execution is currently unavailable. The Remove, Customize, and Add buttons are visual-only right now."

## 🛠️ Technical Details

### Architecture

- **Background Service Worker**: Listens for icon clicks and sends toggle messages
- **Content Script**: Injects the full chat panel into every page
- **Panel**: Self-contained component with state management
- **Direct Toggle**: No popup window - icon click directly controls panel

### Permissions

- `activeTab`: Access the currently active tab
- `scripting`: Inject scripts into web pages
- `<all_urls>`: Work on any website

### Panel Behavior

- **Size**: 360px × 640px (mobile phone proportions)
- **Position**: Centered on screen (overlay)
- **Layout**: Floats above page content, no layout shift
- **Transitions**: Fade in/out with scale animation (0.3s)
- **Z-index**: 2147483647 (appears above everything)
- **Design**: Rounded corners (36px), bordered frame

### Content Scripts

The extension automatically injects:
- `contentScript.js`: Lightweight runtime placeholder
- `contentStyles.css`: Legacy styling kept in the repo
- `panel.css`: Complete panel styling with gradients and animations

### Message Passing

**Flow**: Icon Click → Background Worker → Content Script → Panel Toggle

- Background service worker sends: `WEBEDIT_TOGGLE_PANEL`
- Content script receives and toggles panel visibility
- No popup window or intermediate UI

## 🎨 Design System

### Colors

- **Primary Gradient**: Blue (#3b82f6) to Pink (#ec4899)
- **Secondary Gradient**: Orange (#f97316) to Indigo (#6366f1)
- **Background**: Light cyan (#d7fbff)
- **Text**: Dark gray (#111827)

### Components

- **Logo Pill**: Gradient background with WebEdit AI branding
- **Tool Chips**: Gray buttons with active state
- **Chat Bubbles**: User (right, white) vs AI (left, gradient background)
- **Input Bar**: Gradient wrapper with icon, input, and send button
- **Customization Panel**: White card with form controls

### Inspiration

- **Mockup Design**: Rounded phone-like frame with gradient header/footer
- **Sider Panel**: Clean AI chat layout with message bubbles
- **Original Colors**: Preserved from the popup design

## 🔮 Future Enhancements

- **Real AI Integration**: Reconnect the preserved API helpers when feature work resumes
- **Supabase Backend**: Store edits in the cloud
- **User Authentication**: Sign in with OAuth
- **Edit History**: View, restore, and share previous edits
- **Sync Across Devices**: Access your edits anywhere
- **Voice Commands**: Speak your edits naturally
- **Element Templates**: Pre-built components to insert
- **CSS Export**: Download your changes as a stylesheet

## 📝 Development Notes

### Current Implementation

- The visible `Remove`, `Customize`, and `Add` buttons are **UI placeholders only**
- The side panel keeps **chat history and account state**
- Supabase and API helpers remain in the codebase but are **not wired to the three feature buttons**

### Code Structure

- **Modular Design**: Easy to add real AI backend
- **Event-Driven**: Clean separation between UI and logic
- **Well-Commented**: Clear function purposes and flow
- **Extensible**: Ready for Supabase, auth, and history features

### Customization

To adjust panel width, edit `panel.css`:
```css
#webedit-chat-panel {
  width: 400px; /* Change this */
}

body.webedit-panel-open {
  margin-right: 400px; /* Match the width */
}
```

## 🐛 Known Limitations

- Edits are not saved between page refreshes
- Some complex web applications may interfere with element picking
- Very dynamic content (SPAs) may lose edits after navigation
- Panel may conflict with sites that use similar z-index values
- First-time load may require page refresh on some sites

## 🔄 Version History

- **v0.3.0**: Direct toggle - Icon click directly controls panel (no popup window)
- **v0.2.0**: Complete refactor to in-page chat panel with popup toggle
- **v0.1.0**: Initial popup-based implementation

## 📄 License

This is an initial development version. License to be determined.

## 🤝 Contributing

This is a solo project in active development. Suggestions welcome!

---

**Built with ❤️ for visual web editing**
