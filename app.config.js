// The build settings Expo reads. Static, client-neutral settings live in app.json; everything that belongs to the client (names,
// store ids, links, colors, pictures, permission wording, and the feature switches that need a native build) comes from the ONE
// settings file, src/config/brand.js. Edit that file, not this one.
//
// expoProjectId / expoOwner in brand.js: while they still start with "YOUR-", they are left out of the config, so `expo start` and
// `expo export` keep working before the project exists on Expo. Push notifications and EAS Update need the real values.
const brand = require('./src/config/brand.js');

const isSet = (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('YOUR-');
const hostOf = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');

/** The options each brand-dependent plugin gets. app.json lists these plugins by name only. */
function pluginOptions(name) {
  const appName = brand.app.name;
  switch (name) {
    case 'expo-image-picker':
      return {
        photosPermission: `Allow ${appName} to access your photos and videos for profile pictures, job photos and task instructions.`,
        cameraPermission: `Allow ${appName} to use the camera for profile pictures, job photos, task instructions and videos.`,
        microphonePermission: `Allow ${appName} to record sound when you film a video for a task.`,
      };
    case 'expo-location':
      return { locationWhenInUsePermission: `${appName} uses your location to check you in when you arrive at a job site.` };
    case 'expo-splash-screen':
      return { backgroundColor: brand.look.splashBackground, image: brand.look.splashImage, imageWidth: 240 };
    case 'expo-notifications':
      return { color: brand.look.brandColor };
    case 'expo-widgets':
      return {
        groupIdentifier: `group.${brand.app.bundleId}`,
        widgets: [
          {
            name: 'ForecastWidget',
            displayName: 'Forecast',
            description: 'Your local weather.',
            ios: { supportedFamilies: ['systemSmall', 'systemMedium', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline'] },
          },
        ],
      };
    default:
      return null;
  }
}

/** The plugin list from app.json with the brand options filled in. The widget plugin is kept only while features.widgets
 *  (and features.weather) is on, so a client without widgets gets no widget in the phone's widget gallery. */
function brandPlugins(plugins) {
  const widgetsOn = brand.features.widgets === true && brand.features.weather === true;
  return (plugins ?? [])
    .filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-widgets' || widgetsOn)
    .map((p) => {
      const name = Array.isArray(p) ? p[0] : p;
      const opts = pluginOptions(name);
      if (!opts) return p;
      return [name, { ...(Array.isArray(p) ? p[1] : {}), ...opts }];
    });
}

module.exports = ({ config }) => {
  const webHost = hostOf(brand.app.webUrl);
  const out = {
    ...config,
    name: brand.app.name,
    slug: brand.app.slug,
    scheme: brand.app.scheme,
    icon: brand.look.icon,
    ios: {
      ...(config.ios ?? {}),
      bundleIdentifier: brand.app.bundleId,
      // Lets invite / approval links on the app's web address open the installed app (no duplicates: EAS Update rejects them).
      associatedDomains: [...new Set([...(config.ios?.associatedDomains ?? []), ...(webHost ? [`applinks:${webHost}`] : [])])],
    },
    android: {
      ...(config.android ?? {}),
      package: brand.app.androidPackage,
      adaptiveIcon: {
        ...(config.android?.adaptiveIcon ?? {}),
        backgroundColor: brand.look.androidIconBackground,
        foregroundImage: brand.look.androidIconForeground,
      },
    },
    web: { ...(config.web ?? {}), favicon: brand.look.icon },
    plugins: brandPlugins(config.plugins),
  };
  if (isSet(brand.app.expoProjectId)) {
    out.extra = { ...(config.extra ?? {}), eas: { ...(config.extra?.eas ?? {}), projectId: brand.app.expoProjectId } };
    out.updates = { ...(config.updates ?? {}), url: `https://u.expo.dev/${brand.app.expoProjectId}` };
  }
  // Over-the-air updates can be switched off for the whole app (features.otaUpdates; needs a new build).
  if (brand.features.otaUpdates !== true) out.updates = { ...(out.updates ?? {}), enabled: false };
  if (isSet(brand.app.expoOwner)) out.owner = brand.app.expoOwner;
  return out;
};
