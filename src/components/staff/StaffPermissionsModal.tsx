"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { usersRepo } from "@/lib/repo/users";
import { updateUserPermissions } from "@/lib/auth";
import { visibleNavFor } from "@/config/navFilter";
import { designation } from "@/config/hospitalStaff";
import { useAuthStore } from "@/store/authStore";
import type { Staff } from "@/lib/types";

/** Which hospital sections a staff member's login may open. A ticked menu
 * group opens all its sub-tabs; otherwise single sub-tabs can be ticked. Starts
 * from what the login has now; "Use designation defaults" restores the pages of
 * the staff member's designation. */
export function StaffPermissionsModal({ staff, onClose, onSaved }: { staff: Staff; onClose: () => void; onSaved: () => void }) {
  const allowedModules = useAuthStore((s) => s.currentTenant?.allowedModules ?? null);
  const [perms, setPerms] = useState<Set<string> | null>(null);
  const [full, setFull] = useState(false);
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const defaults = designation(staff.staff_category)?.pages ?? null;
  const menu = visibleNavFor("hospital", allowedModules, null);

  useEffect(() => {
    if (!staff.user_id) return;
    void usersRepo.get(staff.user_id).then((u) => {
      setUsername(u?.username ?? "");
      let list: string[] | null = null;
      try { list = u?.permissions ? (JSON.parse(u.permissions) as string[]) : null; } catch { list = null; }
      setFull(list === null);
      setPerms(new Set(list ?? defaults ?? []));
    });
  }, [staff.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) => setPerms((p) => {
    const next = new Set(p);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  async function save() {
    if (!staff.user_id || !perms) return;
    if (!full && perms.size === 0) return window.alert("Tick at least one section, or give full access.");
    setSaving(true);
    try {
      await updateUserPermissions(staff.user_id, full ? null : [...perms]);
      onSaved();
    } catch (e) {
      window.alert(`Could not save the permissions: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Permissions · ${staff.name}`} onClose={onClose} width="max-w-xl">
      {!perms ? <p className="text-sm text-neutral-400">Loading…</p> : (
        <>
          <p className="mb-3 text-xs text-neutral-500">
            Login <span className="font-mono">{username}</span>{staff.designation ? ` · ${staff.designation}` : ""}. Changes apply the next time this login opens a page.
          </p>
          <label className="mb-3 flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm">
            <input id="perm-full" type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
            <span><b>Full access</b> <span className="text-neutral-500">(every section, like the owner; for Admin logins)</span></span>
          </label>
          <div className={`flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-200 ${full ? "pointer-events-none opacity-50" : ""}`}>
            {menu.map((item) => {
              const group = perms.has(item.moduleKey);
              const keyed = (item.children ?? []).filter((c) => c.moduleKey && c.moduleKey !== item.moduleKey);
              return (
                <div key={item.moduleKey} className="px-3 py-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input id={`perm-${item.moduleKey}`} type="checkbox" checked={group} onChange={() => toggle(item.moduleKey)} />
                    {item.label}
                    {item.children?.length ? <span className="text-xs font-normal text-neutral-400">{group ? "all sub-tabs" : keyed.length ? "or choose below" : ""}</span> : null}
                  </label>
                  {keyed.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-6">
                      {keyed.map((c) => (
                        <label key={c.moduleKey} className={`flex items-center gap-1.5 text-xs ${group ? "text-neutral-400" : "text-neutral-700"}`}>
                          <input id={`perm-${c.moduleKey}`} type="checkbox" disabled={group} checked={group || perms.has(c.moduleKey!)} onChange={() => toggle(c.moduleKey!)} />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {defaults && <Button className="mr-auto" onClick={() => { setFull(false); setPerms(new Set(defaults)); }}>Use designation defaults</Button>}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save permissions"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
