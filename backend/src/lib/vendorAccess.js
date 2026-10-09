export const FULL_ACCESS_ROLES = new Set([
  'admin',
  'leadership',
  'office_boy',
  'facility_manager',
  'finance',
]);

export function isFullAccessRole(role) {
  return Boolean(role) && FULL_ACCESS_ROLES.has(role);
}

export function isVendorRole(role) {
  return role === 'vendor';
}

export function normalizeVendorValue(value) {
  return String(value ?? '').trim();
}

export function isVendorAuthorizedForResource({ user, resource, ownerKeys = ['vendor_id', 'user_id', 'created_by', 'owner_id'] }) {
  if (!user || !resource) return true;
  if (!isVendorRole(user.role) || isFullAccessRole(user.role)) return true;

  const ownerValues = ownerKeys
    .map((key) => ({ key, value: resource[key] }))
    .filter(({ value }) => value !== undefined && value !== null && normalizeVendorValue(value) !== '');

  if (ownerValues.length === 0) {
    return true;
  }

  return ownerValues.some(({ value }) => normalizeVendorValue(value) === normalizeVendorValue(user.id));
}

export function requireVendorAccess({ ownerKeys = ['vendor_id', 'user_id', 'created_by', 'owner_id'], getResource }) {
  return async (req, res, next) => {
    try {
      if (!req?.user) return res.status(401).json({ error: 'Unauthenticated' });
      if (!isVendorRole(req.user.role) || isFullAccessRole(req.user.role)) {
        return next();
      }

      const requestHasVendorSpecificContext =
        Object.keys(req.params || {}).some((key) => /vendor|report|service|client/i.test(key)) ||
        Object.keys(req.query || {}).some((key) => /vendor|report|service|client/i.test(key)) ||
        Object.keys(req.body || {}).some((key) => /vendor|report|service|client/i.test(key));

      if (!requestHasVendorSpecificContext) {
        return next();
      }

      const resource = typeof getResource === 'function' ? await getResource(req) : null;
      if (!resource) {
        return next();
      }

      if (isVendorAuthorizedForResource({ user: req.user, resource, ownerKeys })) {
        return next();
      }

      return res.status(403).json({ error: 'Access denied: this vendor is not authorized for the requested report or service.' });
    } catch (error) {
      next(error);
    }
  };
}

export function vendorScopeMatchesUser({ user, row, ownerKeys = ['vendor_id', 'user_id', 'created_by', 'owner_id'] }) {
  return isVendorAuthorizedForResource({ user, resource: row, ownerKeys });
}
