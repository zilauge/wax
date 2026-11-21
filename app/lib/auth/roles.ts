/** Channel credentials are workspace-wide, so agents may never change them. */
export function canManageChannels(role: "owner" | "admin" | "agent") {
  return role !== "agent";
}
