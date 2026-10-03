export const PERMISSION_GROUPS = {
  Campaigns: ["campaigns_view", "campaigns_create", "campaigns_edit", "campaigns_delete"],
  Contacts: ["contacts_view", "contacts_create", "contacts_edit", "contacts_delete"],
  Calls: ["calls_view"],
  Recordings: ["recordings_view", "recordings_download"],
  Analytics: ["analytics_view"],
  Reports: ["reports_view"],
};
export const PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();

/** Validate a permission list; create/edit/delete (and download) automatically imply the matching view. */
export function normalizePermissions(list) {
  if (!Array.isArray(list)) return { error: "permissions must be an array" };
  const bad = list.filter((p) => !PERMISSIONS.includes(p));
  if (bad.length) return { error: `Unknown permission(s): ${bad.join(", ")}` };
  const set = new Set(list);
  for (const p of list) {
    const [module, action] = p.split("_");
    if (action !== "view") set.add(module === "recordings" ? "recordings_view" : `${module}_view`);
  }
  return { permissions: [...set] };
}
