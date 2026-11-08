// Static settings live in app.json. This file adds the Expo project settings and removes duplicate associated domains,
// which EAS Update rejects.
//
// FILL IN after running `eas init` for your own Expo account (placeholders until then):
//   EXPO_PROJECT_ID  the project id `eas init` prints (also used for the over-the-air update address)
//   EXPO_OWNER       your Expo account or organisation name
// While they still start with "YOUR-", they are left out of the config, so `expo start` and `expo export` keep working
// before the project exists on Expo. Push notifications and EAS Update need the real values.
const EXPO_PROJECT_ID = 'YOUR-EXPO-PROJECT-ID';
const EXPO_OWNER = 'YOUR-EXPO-ACCOUNT';

const isSet = (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('YOUR-');

module.exports = ({ config }) => {
  const ios = config.ios ?? {};
  if (Array.isArray(ios.associatedDomains)) ios.associatedDomains = [...new Set(ios.associatedDomains)];
  const out = { ...config, ios };
  if (isSet(EXPO_PROJECT_ID)) {
    out.extra = { ...(config.extra ?? {}), eas: { ...(config.extra?.eas ?? {}), projectId: EXPO_PROJECT_ID } };
    out.updates = { ...(config.updates ?? {}), url: `https://u.expo.dev/${EXPO_PROJECT_ID}` };
  }
  if (isSet(EXPO_OWNER)) out.owner = EXPO_OWNER;
  return out;
};
