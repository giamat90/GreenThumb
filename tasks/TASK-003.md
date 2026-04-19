# TASK-003: Invite Friends from Following tab FAB button

## Status: DONE

## Overview
The Community screen's "+" FAB button on the Following tab currently opens the Share Post screen (same as Discover). This task changes the Following tab's FAB to open a new "Invite Friends" screen with a device contact picker. Users select contacts, then a native share sheet opens with a pre-filled invite message and Play Store link. The invite feature is free for all users (no Pro gate). The Discover tab FAB keeps its current Share Post behavior.

## User story
As a user on the Following tab, I want to invite friends from my contacts so that I can grow my community and have more people to follow.

## Acceptance criteria
- [ ] Following tab "+" FAB opens the invite contacts screen (no Pro gate)
- [ ] Discover tab "+" FAB still opens Share Post screen (Pro-gated, unchanged)
- [ ] FAB icon: `Plus` on Discover, `UserPlus` on Following
- [ ] Invite screen requests contacts permission with proper UX (grant/deny/settings redirect)
- [ ] Contact list loads with name + phone/email, supports search filtering
- [ ] Multi-select with visual checkbox feedback
- [ ] "Send Invite (N)" button disabled when none selected
- [ ] Send opens native share sheet with invite message + Play Store link
- [ ] Empty contacts state shown when no contacts match
- [ ] Route registered in `_layout.tsx`
- [ ] `READ_CONTACTS` permission in `app.json` and `AndroidManifest.xml`
- [ ] 11 new i18n keys in all 10 locale files
- [ ] No hardcoded pixel values for layout spacing

## Technical plan

### Files to create
| File | Purpose |
|------|---------|
| `app/community/invite.tsx` | Contact picker screen with multi-select, search, and share |

### Files to modify
| File | Change |
|------|--------|
| `app/(tabs)/community.tsx` | FAB `onPress` conditional on `activeTab`; change icon to `UserPlus` on Following; update imports and accessibility label |
| `app/_layout.tsx` | Add `<Stack.Screen name="community/invite" options={{ headerShown: false }} />` after line 313 |
| `app.json` | Add `"android.permission.READ_CONTACTS"` to `android.permissions`; add `["expo-contacts", { "contactsPermission": "..." }]` to `plugins` |
| `android/app/src/main/AndroidManifest.xml` | Add `<uses-permission android:name="android.permission.READ_CONTACTS"/>` |
| `locales/en.json` | Add 11 community invite keys |
| `locales/it.json` | Add 11 translated keys |
| `locales/es.json` | Add 11 translated keys |
| `locales/fr.json` | Add 11 translated keys |
| `locales/de.json` | Add 11 translated keys |
| `locales/pt.json` | Add 11 translated keys |
| `locales/nl.json` | Add 11 translated keys |
| `locales/pl.json` | Add 11 translated keys |
| `locales/ja.json` | Add 11 translated keys |
| `locales/zh.json` | Add 11 translated keys |

### Database changes
None.

### Edge functions
None.

### i18n keys
Add under `community` in all 10 locales:

| Key | en | it |
|-----|----|----|
| `inviteFriends` | Invite Friends | Invita Amici |
| `inviteSubtitle` | Select contacts to invite to GreenThumb | Seleziona i contatti da invitare su GreenThumb |
| `searchContacts` | Search contacts... | Cerca contatti... |
| `sendInvite` | Send Invite ({{count}}) | Invia Invito ({{count}}) |
| `inviteMessage` | Join me on GreenThumb, the AI plant care app! Download it here: https://play.google.com/store/apps/details?id=com.giamat90.greenthumb | Unisciti a me su GreenThumb, l'app per la cura delle piante con AI! Scaricala qui: https://play.google.com/store/apps/details?id=com.giamat90.greenthumb |
| `noContactsFound` | No contacts found | Nessun contatto trovato |
| `contactsPermission` | Contacts Access | Accesso ai Contatti |
| `contactsPermissionDesc` | GreenThumb needs access to your contacts to send invitations to your friends. | GreenThumb ha bisogno di accedere ai tuoi contatti per inviare inviti ai tuoi amici. |
| `grantAccess` | Grant Access | Consenti Accesso |
| `contactsPermissionDenied` | Contacts access was denied. Please enable it in Settings to invite friends. | L'accesso ai contatti è stato negato. Abilitalo nelle Impostazioni per invitare amici. |
| `selected` | {{count}} selected | {{count}} selezionati |

Translate appropriately for es, fr, de, pt, nl, pl, ja, zh.

## Implementation steps

### Step 1 — Install `expo-contacts`
```bash
npx expo install expo-contacts
```

### Step 2 — Add permissions to `app.json`
Add `"android.permission.READ_CONTACTS"` to the `android.permissions` array (after the existing permissions around line 38).

Add to the `plugins` array:
```json
["expo-contacts", { "contactsPermission": "GreenThumb needs access to your contacts to invite friends." }]
```

### Step 3 — Add permission to `AndroidManifest.xml`
In `android/app/src/main/AndroidManifest.xml`, add:
```xml
<uses-permission android:name="android.permission.READ_CONTACTS"/>
```
Place it near the other `<uses-permission>` entries.

### Step 4 — Add i18n keys to all 10 locale files
Add the 11 keys listed above inside the `"community"` object in each locale file. Insert after the last existing community key (`shareAPost`). Validate no duplicate keys exist.

### Step 5 — Create `app/community/invite.tsx`

Follow the exact patterns from `app/community/new-post.tsx`:
- `Stack.Screen options={{ headerShown: false }}` inside component
- Manual back button with `ArrowLeft` icon
- `useSafeAreaInsets()` for top/bottom padding
- `onLayout` for action bar height measurement
- Content `paddingBottom: actionBarHeight + 16`

**Screen structure:**

```
┌─────────────────────────────────┐
│ [←] Invite Friends              │  ← Header with back button
│     Select contacts to invite   │  ← Subtitle
├─────────────────────────────────┤
│ 🔍 Search contacts...           │  ← TextInput with Search icon
├─────────────────────────────────┤
│ [✓] Alice Smith                 │  ← FlatList of contacts
│     +1 555-1234                 │     with checkbox + name + phone/email
│ [ ] Bob Johnson                 │
│     bob@email.com               │
│ [✓] Carol Williams             │
│     +1 555-5678                 │
│                                 │
│  (or "No contacts found")      │  ← Empty state
├─────────────────────────────────┤
│ PERMISSION STATES:              │
│ - undetermined: show explain +  │
│   "Grant Access" button         │
│ - denied: show message +        │
│   "Open Settings" button        │
│ - granted: show contact list    │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│  [ Send Invite (2) ]            │  ← Fixed bottom action bar
└─────────────────────────────────┘
```

**State:**
```tsx
const [contacts, setContacts] = useState<Contacts.Contact[]>([]);
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [searchQuery, setSearchQuery] = useState("");
const [permissionStatus, setPermissionStatus] = useState<"undetermined" | "granted" | "denied">("undetermined");
const [loading, setLoading] = useState(true);
const [actionBarHeight, setActionBarHeight] = useState(0);
```

**Permission flow:**
1. On mount, call `Contacts.getPermissionsAsync()`
2. If `undetermined`, render explanation + "Grant Access" button that calls `Contacts.requestPermissionsAsync()`
3. If `denied`, render message + "Open Settings" button via `Linking.openSettings()`
4. If `granted`, fetch contacts: `Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails], sort: Contacts.SortTypes.FirstName })`

**Contact filtering:**
- Filter `contacts` with `useMemo` based on `searchQuery` (case-insensitive match on `firstName` + `lastName`)
- Filter out contacts with no name AND no phone/email
- Use `FlatList` with `keyExtractor={(item) => item.id}`

**Contact row rendering:**
- Checkbox: `Check` icon (selected) or `Square` icon (unselected) from lucide
- Name: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim()
- Subtitle: first phone number, or first email, or empty
- Tap toggles `selectedIds` Set

**Send action:**
- Fixed bottom bar with `onLayout` measurement
- Button text: `t("community.sendInvite", { count: selectedIds.size })`
- Disabled when `selectedIds.size === 0`
- On press: `Share.share({ message: t("community.inviteMessage") })`
- After share (resolved), call `navigation.goBack()`

**Styles** — follow `new-post.tsx` conventions:
- `screen: { flex: 1, backgroundColor: COLORS.cream }`
- Header area with back button, title, subtitle
- Search input: white bg, rounded, Search icon, padding
- Contact row: white bg, borderBottomWidth 1, borderBottomColor COLORS.cream
- Action bar: absolute bottom, white bg, shadow, borderTop
- Send button: green primary bg, rounded, white text, full width
- Use `COLORS.primary`, `COLORS.cream`, `COLORS.textPrimary`, `COLORS.textSecondary`

### Step 6 — Register route in `app/_layout.tsx`
Add after the existing community routes (line 313):
```tsx
<Stack.Screen name="community/invite" options={{ headerShown: false }} />
```

### Step 7 — Modify FAB in `app/(tabs)/community.tsx`

**Update imports** (around line 14): Add `UserPlus` to lucide imports.

**Replace `handleNewPost` callback** (lines 398-401) with:
```tsx
const handleFabPress = useCallback(() => {
  if (activeTab === "discover") {
    if (!requirePro(t("paywall.featureCommunity"))) return;
    router.push("/community/new-post");
  } else {
    router.push("/community/invite");
  }
}, [activeTab, requirePro, router, t]);
```

**Update FAB button** (lines 507-521):
- Change `onPress={handleNewPost}` to `onPress={handleFabPress}`
- Change icon to conditional: `activeTab === "discover" ? <Plus .../> : <UserPlus .../>`
- Change `accessibilityLabel` to conditional: `activeTab === "discover" ? t("community.sharePost") : t("community.inviteFriends")`

## Testing checklist
- [ ] Free user: Following "+" opens invite screen (no Pro gate)
- [ ] Free user: Discover "+" shows upgrade modal
- [ ] Pro user: Discover "+" opens Share Post screen
- [ ] Pro user: Following "+" opens invite screen
- [ ] Contacts permission: undetermined → grant access flow works
- [ ] Contacts permission: denied → "Open Settings" flow works
- [ ] Contacts permission: granted → contacts load and display
- [ ] Search filters contacts by name
- [ ] Multi-select: checkboxes toggle correctly
- [ ] "Send Invite (N)" disabled when 0 selected, shows count when N > 0
- [ ] Share sheet opens with correct invite message and Play Store link
- [ ] Empty state shown when no contacts or no search matches
- [ ] i18n: tested in at least 2 languages (en, it)
- [ ] No hardcoded pixel values — action bar uses `onLayout`
- [ ] FAB icon switches between Plus and UserPlus on tab change
- [ ] Back button on invite screen returns to community Following tab

## Dependencies
None. Requires `npx expo prebuild --clean` + device build after implementation.

## Notes
- `expo-contacts` is a native module — requires a new native build (not just JS bundle reload)
- Follow the permission denial pattern from `components/ui/NotificationSettings.tsx` (Alert + Linking.openSettings)
- The Play Store URL in `inviteMessage` uses the app package: `com.giamat90.greenthumb`
- Contact data is variable: some have phones only, some emails only, some both, some neither — filter out contacts with no name AND no contact info
- Performance: use `FlatList` (not ScrollView) and `useMemo` for filtered contacts — users may have thousands of contacts

## Implementation notes

- Installed `expo-contacts` via `npx expo install expo-contacts`
- Added `android.permission.READ_CONTACTS` to `app.json` permissions array and `expo-contacts` plugin entry
- Added `<uses-permission android:name="android.permission.READ_CONTACTS"/>` to `AndroidManifest.xml`
- Added 11 i18n keys to all 10 locale files under the `community` object, after `shareAPost`
- Created `app/community/invite.tsx` with:
  - `Contacts.ExistingContact[]` type (not `Contact` — `getContactsAsync` returns ExistingContact which guarantees `id: string`)
  - Three permission states: undetermined (explain + Grant Access), denied (message + Open Settings via Alert + Linking), granted (contact list)
  - `onLayout` for action bar height measurement (no hardcoded pixel values)
  - `useMemo` filtered contacts list via `FlatList` for performance
  - Multi-select with `Set<string>` state, Check/Square lucide icons for checkboxes
  - Native `Share.share()` API, calls `navigation.goBack()` after successful share
  - `useSafeAreaInsets()` for top/bottom padding, pattern matches `new-post.tsx`
- Registered `community/invite` route in `app/_layout.tsx`
- Modified `app/(tabs)/community.tsx`:
  - Added `UserPlus` to lucide imports
  - Replaced `handleNewPost` with `handleFabPress` (conditional on `activeTab`)
  - FAB icon switches between `Plus` (discover) and `UserPlus` (following)
  - FAB `accessibilityLabel` is also conditional on `activeTab`
