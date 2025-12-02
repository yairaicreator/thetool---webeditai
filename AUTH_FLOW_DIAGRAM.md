# Authorization & Sync Flow Diagrams

## 1. Unauthorized User Attempts Edit

```
┌─────────────────────────────────────────────────────────────┐
│  User clicks "Remove", "Customize", "Add", or "Pick"        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  requireAuth() check │
              └──────────┬───────────┘
                         │
                    ┌────┴────┐
                    │ Signed  │
                    │   in?   │
                    └────┬────┘
                         │
            ┌────────────┼────────────┐
            │ NO         │ YES        │
            ▼            ▼            
    ┌───────────────┐   ┌────────────────┐
    │ Block action  │   │ Allow action   │
    │ Show error    │   │ Proceed with   │
    │ Pulse button  │   │ edit operation │
    └───────────────┘   └────────────────┘
```

## 2. Website → Extension Auth Sync

```
┌──────────────────────────────────────────────────────────────┐
│  User signs in on www.webeditai.com                          │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Session stored in    │
              │ website localStorage │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Extension checks     │
              │ every 3 seconds      │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ syncAuthFromWebsite()│
              │ detects new session  │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Copy session to      │
              │ chrome.storage.local │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Update extension UI  │
              │ Show avatar          │
              │ Enable all features  │
              └──────────────────────┘
```

## 3. Extension → Website Auth Sync

```
┌──────────────────────────────────────────────────────────────┐
│  User signs in via extension (opens webeditai.com)           │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ User completes       │
              │ sign-in on website   │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Website stores       │
              │ session in localStorage│
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Extension sync       │
              │ detects new session  │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ syncAuthToWebsite()  │
              │ ensures consistency  │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Both extension and   │
              │ website are signed in│
              └──────────────────────┘
```

## 4. Bidirectional Sync Loop (on webeditai.com)

```
     ┌─────────────────────────────────────────────┐
     │                                             │
     │  Extension on www.webeditai.com             │
     │                                             │
     └──────────────────┬──────────────────────────┘
                        │
                        ▼
         ┌──────────────────────────┐
         │  startAuthSync()         │
         │  Runs every 3 seconds    │
         └──────────┬───────────────┘
                    │
         ┌──────────┴──────────┐
         │                     │
         ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│ Website         │   │ Extension       │
│ localStorage    │   │ chrome.storage  │
│                 │   │                 │
│ Session Token A │   │ Session Token B │
└────────┬────────┘   └────────┬────────┘
         │                     │
         │    Compare tokens   │
         └──────────┬──────────┘
                    │
              ┌─────┴─────┐
              │ Different?│
              └─────┬─────┘
                    │
         ┌──────────┼──────────┐
         │ YES      │ NO       │
         ▼          ▼          
    ┌────────┐  ┌──────────┐
    │  Sync  │  │ Continue │
    │ newer  │  │ checking │
    │ token  │  │          │
    └────────┘  └──────────┘
         │           │
         └───────────┴──────────┐
                                │
                                ▼
                     ┌──────────────────┐
                     │ Wait 3 seconds   │
                     │ Check again      │
                     └────────┬─────────┘
                              │
                              └─────────┐
                                        │
                                        ▼
                              (Loop continues)
```

## 5. Sign Out Sync

```
┌──────────────────────────────────────────────────────────────┐
│  User signs out (website OR extension)                       │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Clear session from   │
              │ source location      │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Sync detects missing │
              │ session (null/empty) │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Clear session from   │
              │ other location too   │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Update both UIs      │
              │ Show "Sign in"       │
              │ Disable all features │
              └──────────────────────┘
```

## 6. Protected Feature Flow (Complete)

```
┌─────────────────────────────────────────────────────────────┐
│  User: "I want to remove this button"                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Click "Remove/hide"  │
              │ from menu            │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ requireAuth()        │
              │ "remove elements"    │
              └──────────┬───────────┘
                         │
                    ┌────┴────┐
                    │ Signed  │
                    │   in?   │
                    └────┬────┘
                         │
            ┌────────────┼────────────┐
            │ NO         │ YES        │
            ▼            ▼            
    ┌───────────────┐   ┌────────────────┐
    │ ❌ BLOCKED    │   │ ✅ ALLOWED     │
    ├───────────────┤   ├────────────────┤
    │ Show error:   │   │ Start Remove   │
    │ "Please sign  │   │ mode           │
    │ in to remove  │   │                │
    │ elements"     │   │ Show indicator │
    │               │   │ "Click element │
    │ Pulse sign-in │   │ to remove"     │
    │ button 3x     │   │                │
    │               │   │ User clicks    │
    │ Action stops  │   │ element        │
    │               │   │                │
    │               │   │ Element hidden │
    │               │   │ Rule saved     │
    │               │   │ Success! ✓     │
    └───────────────┘   └────────────────┘
```

## Key Components

### Auth Check Points:
1. **Remove/hide button** → `requireAuth("remove elements")`
2. **Customize button** → `requireAuth("customize elements")`
3. **Add button** → `requireAuth("add features")`
4. **Pick element button** → `requireAuth("pick elements")`
5. **Apply button** (Customize panel) → `requireAuth("apply customizations")`

### Sync Components:
- **Sync Interval**: 3 seconds
- **Sync Domain**: www.webeditai.com only
- **Storage Locations**:
  - Extension: `chrome.storage.local['webeditSupabaseSession']`
  - Website: `localStorage['sb-eqfjkvjwsswjxkmomxax-auth-token']`

### Visual Feedback:
- ❌ Error notification with red styling
- 💓 Pulse animation on sign-in button (3 pulses)
- ✅ Success notification when signed in
- 👤 Avatar appears when authenticated

## Summary

This system ensures:
1. **No unauthorized edits** - All features require authentication
2. **Seamless sync** - Sign in once, use everywhere
3. **Clear feedback** - Users know exactly what to do
4. **Consistent state** - Website and extension always match
5. **Secure** - Sessions properly stored and validated

