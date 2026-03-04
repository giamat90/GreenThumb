# EAS Build — Environment Secrets Setup

EAS cloud builds need your environment variables to be uploaded as
project secrets. Run these commands once (values are stored encrypted
on Expo's servers and injected at build time):

```sh
npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "your_supabase_url"
npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "your_supabase_anon_key"
npx eas secret:create --scope project --name EXPO_PUBLIC_OPENWEATHER_API_KEY --value "your_openweather_key"
npx eas secret:create --scope project --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value "your_revenuecat_android_key"
```

## ⚠️  Keys that must NOT be added as EAS secrets

| Key | Reason |
|-----|--------|
| `ANTHROPIC_API_KEY` | Server-side only — lives in Supabase Edge Function secrets |
| `PLANT_ID_API_KEY` | Server-side only — lives in Supabase Edge Function secrets |

These keys are called from Supabase Edge Functions, never from the
mobile app bundle. Adding them to EAS would expose them in the APK.

## Verify secrets

```sh
npx eas secret:list
```

## Rotate a secret

```sh
npx eas secret:delete --name EXPO_PUBLIC_SUPABASE_URL
npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "new_value"
```
