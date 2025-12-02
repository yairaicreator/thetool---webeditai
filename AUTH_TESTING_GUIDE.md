# Authorization & Sync Testing Guide

## Quick Test Scenarios

### Test 1: Block Unauthorized Remove
**Goal**: Verify unauthorized users cannot remove elements

1. **Setup**: Sign out of extension (if signed in)
2. **Action**: Click hamburger menu → "Remove/hide"
3. **Expected**:
   - ❌ Error notification: "Please sign in to remove elements"
   - 💓 Sign-in button pulses 3 times
   - ⛔ Remove mode does NOT start
   - No hover effects on page elements

**Pass Criteria**: Cannot remove any elements without signing in

---

### Test 2: Block Unauthorized Customize
**Goal**: Verify unauthorized users cannot customize elements

1. **Setup**: Sign out of extension
2. **Action**: Click hamburger menu → "Customize"
3. **Expected**:
   - ❌ Error notification: "Please sign in to customize elements"
   - 💓 Sign-in button pulses
   - Customize panel does NOT open

**Pass Criteria**: Cannot access customization features

---

### Test 3: Block Unauthorized Add
**Goal**: Verify unauthorized users cannot add features

1. **Setup**: Sign out of extension
2. **Action**: Click hamburger menu → "Add"
3. **Expected**:
   - ❌ Error notification: "Please sign in to add features"
   - 💓 Sign-in button pulses
   - Pick mode does NOT start

**Pass Criteria**: Cannot add new features

---

### Test 4: Block Unauthorized Pick Element
**Goal**: Verify unauthorized users cannot pick elements

1. **Setup**: Sign out of extension
2. **Action**: Click "Pick element" button
3. **Expected**:
   - ❌ Error notification: "Please sign in to pick elements"
   - 💓 Sign-in button pulses
   - Pick mode does NOT start

**Pass Criteria**: Cannot select elements for editing

---

### Test 5: Website → Extension Sync
**Goal**: Verify signing in on website syncs to extension

1. **Setup**: 
   - Sign out of both website and extension
   - Open extension panel on any page
   - Verify "Sign in" button is showing

2. **Action**:
   - Open www.webeditai.com in new tab
   - Sign in on the website
   - Wait 3-5 seconds
   - Return to extension panel

3. **Expected**:
   - ✅ Extension shows avatar (not "Sign in" button)
   - ✅ Success notification: "Signed in successfully!"
   - ✅ All features now work (Remove, Customize, Add, Pick)

**Pass Criteria**: Extension automatically signs in within 5 seconds

---

### Test 6: Extension → Website Sync
**Goal**: Verify signing in via extension syncs to website

1. **Setup**:
   - Sign out of both
   - Open extension panel

2. **Action**:
   - Click "Sign in" in extension
   - Complete sign-in on webeditai.com
   - Navigate back to extension

3. **Expected**:
   - ✅ Extension shows avatar
   - ✅ Website shows signed-in state
   - ✅ Both have same session

**Pass Criteria**: Both extension and website are signed in

---

### Test 7: Sign Out Sync
**Goal**: Verify signing out syncs between website and extension

1. **Setup**: Sign in on both website and extension

2. **Action A** (Sign out on website):
   - Sign out on www.webeditai.com
   - Wait 3-5 seconds
   - Check extension

3. **Expected**:
   - Extension shows "Sign in" button
   - All features are blocked

4. **Action B** (Sign out in extension):
   - Sign in again
   - Click avatar in extension → "Sign Out"
   - Check website

5. **Expected**:
   - Website shows signed-out state
   - Extension shows "Sign in" button

**Pass Criteria**: Sign out syncs in both directions

---

### Test 8: Authorized User Can Edit
**Goal**: Verify signed-in users can use all features

1. **Setup**: Sign in to extension

2. **Test Remove**:
   - Click "Remove/hide"
   - ✅ Remove mode starts
   - ✅ Can hover and remove elements

3. **Test Customize**:
   - Click "Customize"
   - ✅ Customize panel opens
   - Click "Pick element"
   - ✅ Pick mode starts
   - Select element
   - Change colors/size
   - Click "Apply"
   - ✅ Styles applied successfully

4. **Test Add**:
   - Click "Add"
   - ✅ Pick mode starts
   - Select element
   - Type description
   - ✅ Feature added

**Pass Criteria**: All features work when signed in

---

### Test 9: Sync Only on WebEdit Domain
**Goal**: Verify sync only runs on webeditai.com

1. **Setup**: Sign in on extension

2. **Action**:
   - Visit www.google.com
   - Open browser console
   - Look for auth sync messages

3. **Expected**:
   - ❌ No sync messages in console
   - Extension still works normally
   - No unnecessary background activity

4. **Action**:
   - Visit www.webeditai.com
   - Check console

5. **Expected**:
   - ✅ "Starting auth sync" message
   - Sync runs every 3 seconds

**Pass Criteria**: Sync only active on webeditai.com

---

### Test 10: Multiple Tabs
**Goal**: Verify sync works across multiple tabs

1. **Setup**: Sign out everywhere

2. **Action**:
   - Open Tab A: www.webeditai.com
   - Open Tab B: www.example.com with extension panel open
   - Sign in on Tab A
   - Wait 5 seconds
   - Check Tab B extension panel

3. **Expected**:
   - Tab B extension shows avatar
   - Tab B features are enabled

**Pass Criteria**: Auth state syncs across all tabs

---

## Edge Case Tests

### Edge 1: Session Expiry
1. Sign in
2. Wait for session to expire (or manually clear token)
3. Try to use features
4. Should prompt to sign in again

### Edge 2: Network Failure
1. Sign in
2. Disconnect internet
3. Try to use features
4. Should still work (local session valid)
5. Reconnect internet
6. Sync should resume

### Edge 3: Extension Context Invalidated
1. Sign in
2. Update/reload extension
3. Refresh page
4. Should maintain signed-in state

### Edge 4: Rapid Sign In/Out
1. Sign in and out rapidly 5 times
2. Final state should be consistent
3. No race conditions or errors

---

## Visual Indicators Checklist

When **NOT signed in**:
- [ ] "Sign in" button visible in header
- [ ] No avatar shown
- [ ] All tool buttons trigger auth error
- [ ] Sign-in button pulses when auth required

When **signed in**:
- [ ] Avatar with first letter of email shown
- [ ] Avatar dropdown works (History, Sign Out)
- [ ] All tool buttons work normally
- [ ] No auth errors

---

## Console Messages to Look For

### Successful Auth:
```
🔐 Auth status: Signed in as user@example.com
✅ Auth synced from website: user@example.com
```

### Auth Required:
```
🔒 Auth required for: remove elements
```

### Sync Active:
```
🔄 On WebEdit AI website, starting auth sync...
🔄 Syncing auth from website to extension...
✅ Auth synced from website
```

### Sign Out:
```
👋 Signing out...
✅ Signed out successfully
```

---

## Performance Checks

### Sync Performance:
- [ ] Sync interval is 3 seconds (not too frequent)
- [ ] Sync only runs on webeditai.com
- [ ] No memory leaks from interval
- [ ] Sync stops when leaving webeditai.com

### UI Performance:
- [ ] Pulse animation smooth (no jank)
- [ ] Notifications appear/disappear cleanly
- [ ] Avatar loads quickly
- [ ] No lag when checking auth

---

## Troubleshooting

### Issue: Auth not syncing
**Check**:
1. Are you on www.webeditai.com?
2. Is localStorage accessible?
3. Check console for errors
4. Verify session format matches

### Issue: Features still blocked after sign in
**Check**:
1. Refresh the page
2. Check if `currentUser` is set in console
3. Verify session in chrome.storage.local
4. Check for console errors

### Issue: Pulse animation not showing
**Check**:
1. Verify panel.css is loaded
2. Check if sign-in button exists
3. Look for CSS animation errors

### Issue: Sync running on wrong domain
**Check**:
1. Verify domain check logic
2. Check `window.location.hostname`
3. Ensure WEBEDIT_DOMAIN constant is correct

---

## Quick Debug Commands

Run these in browser console:

```javascript
// Check current user
console.log('Current user:', currentUser);

// Check if signed in
console.log('Signed in:', !!currentUser);

// Check session in storage
chrome.storage.local.get(['webeditSupabaseSession'], (result) => {
  console.log('Session:', result.webeditSupabaseSession);
});

// Check if sync is running
console.log('Auth sync active:', !!authSyncInterval);

// Manually trigger sync
syncAuthFromWebsite();

// Check website localStorage
console.log('Website session:', localStorage.getItem('sb-eqfjkvjwsswjxkmomxax-auth-token'));
```

---

## Success Criteria Summary

✅ **Authorization Protection**:
- All features blocked when not signed in
- Clear error messages shown
- Visual feedback (pulse animation)
- No edits possible without auth

✅ **Auth Sync**:
- Website → Extension sync works (< 5 seconds)
- Extension → Website sync works
- Sign out syncs both directions
- Only runs on webeditai.com domain
- No performance issues

✅ **User Experience**:
- Smooth sign-in flow
- Clear feedback at all times
- No confusion about auth state
- Consistent across website and extension

