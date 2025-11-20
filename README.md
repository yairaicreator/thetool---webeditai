# WebEdit AI Chrome Extension

A Chrome extension that injects an AI-powered chat panel into any webpage, allowing you to visually edit, hide, customize, or add elements through natural conversation.

## 🚀 Features

- **In-Page AI Chat Panel**: Sider-style right-side panel that pushes content left
- **Natural Language Editing**: Describe what you want to change in plain English
- **Visual Element Picker**: Hover and click to select elements with visual feedback
- **Remove/Hide**: Click to hide any element on a webpage
- **Customize**: Change background color, text color, and font size of elements
- **Add**: Insert new styled elements at any location
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

1. **Type your request** in the chat input at the bottom
   - Examples: "I want to hide an element", "Customize the header", "Add new content"
2. **The AI will guide you** with step-by-step instructions
3. **Click the hamburger menu** (☰) to see the three editing tools:
   - Remove / hide
   - Customize
   - Add
4. **Click "Pick element"** to activate element selection
5. **Hover and click** an element on the page to apply your chosen action

### Chat Features

- **Suggestion Chips**: Quick-start actions for common tasks
- **Smart Responses**: The AI automatically selects the right tool based on your message
- **Conversation History**: See all your interactions in the chat thread
- **Visual Feedback**: Blue outline on hover, pink outline on selection

### Remove/Hide Mode

- Select an element and it will immediately be hidden
- Perfect for removing ads, popups, or unwanted content

### Customize Mode

- After selecting an element, the customization panel appears
- Adjust:
  - **Background color** (color picker)
  - **Text color** (color picker)
  - **Font size** (8-72px)
- Click **Apply** to save changes
- Click **Reset** to remove all custom styles

### Add Mode

- Select an element as a reference point
- A new styled element will be inserted after your selection
- You can then customize the new element

### Panel Controls

- **History** button: Placeholder for future edit history feature
- **Sign in** button: Placeholder for future authentication
- **Close (×)**: Close the panel and restore normal page width

## 💡 Example Conversations

**User:** "I want to hide the cookie banner"
**AI:** "Got it! I'll help you hide an element. 1. Make sure 'Remove / hide' is selected 2. Click 'Pick element' 3. Hover and click the element you want to hide"

**User:** "Change the color of the header"
**AI:** "Perfect! Let's customize an element. 1. Select 'Customize' from the Visual Edit menu 2. Click 'Pick element' 3. Choose the header 4. Use the customization panel to adjust colors"

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
- `contentScript.js`: Panel creation, chat logic, element manipulation
- `contentStyles.css`: Visual feedback for element picking
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

- **Real AI Integration**: Connect to OpenAI/Anthropic for intelligent editing
- **Supabase Backend**: Store edits in the cloud
- **User Authentication**: Sign in with OAuth
- **Edit History**: View, restore, and share previous edits
- **Sync Across Devices**: Access your edits anywhere
- **Advanced Add Tool**: Rich text editor and component library
- **Voice Commands**: Speak your edits naturally
- **Element Templates**: Pre-built components to insert
- **CSS Export**: Download your changes as a stylesheet

## 📝 Development Notes

### Current Implementation

- All edits are **local only** (not persisted)
- AI responses are **rule-based** (simple keyword matching)
- Refreshing the page will **clear all changes**
- Each edited element gets a unique `data-webedit-id` attribute

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
