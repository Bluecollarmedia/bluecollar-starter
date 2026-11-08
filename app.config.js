// Static settings live in app.json. This only removes duplicate associated domains, which EAS Update rejects.
module.exports = ({ config }) => {
  const ios = config.ios ?? {};
  if (Array.isArray(ios.associatedDomains)) ios.associatedDomains = [...new Set(ios.associatedDomains)];
  return { ...config, ios };
};
