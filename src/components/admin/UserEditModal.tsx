"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { usersRepo } from "@/lib/repo/users";
import { updateUserPermissions } from "@/lib/auth";
import { dbSelect } from "@/lib/db";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { presetActions, presetModules, presetsFor } from "@/lib/rolePresets";
import { visibleNavFor } from "@/config/navFilter";
import { usesHospitalStaff } from "@/config/hospitalStaff";
import type { Staff } from "@/lib/types";
import type { UserAccount } from "@/lib/types2";
import { notify } from "@/lib/notify";

/** Edits a staff login: its name and its role. A new role replaces the login's
 * sections and actions with the role's; in a hospital or radiology centre the
 * staff member linked to the login gets the new designation too. */
export function UserEditModal({ user, typeId, canEditStaff, onClose, onSaved }: {
  user: UserAccount;
  typeId: string;
  /** The business's own owner (not the Super Admin): may change the linked staff member's designation. */
  canEditStaff: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const presets = presetsFor(typeId);
  const staffRoles = usesHospitalStaff(typeId);
  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [roleId, setRoleId] = useState("");
  const [staff, setStaff] = useState<Staff | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!staffRoles) return;
    void dbSelect<Staff>(`SELECT * FROM staff WHERE user_id = ? AND deleted_at IS NULL LIMIT 1`, [user.id])
      .then((rows) => {
        setStaff(rows[0] ?? null);
        if (rows[0] && presets.some((p) => p.id === rows[0].staff_category)) setRoleId(rows[0].staff_category ?? "");
      })
      .catch(() => setStaff(null));
  }, [user.id, staffRoles]); // eslint-disable-line react-hooks/exhaustive-deps

  const preset = presets.find((p) => p.id === roleId) ?? null;
  const roleChanged = Boolean(preset) && (!staffRoles || !staff || staff.staff_category !== roleId);

  async function save() {
    setSaving(true);
    try {
      if ((displayName.trim() || null) !== (user.display_name ?? null)) await usersRepo.update(user.id, { display_name: displayName.trim() || null });
      if (preset) {
        // The linked staff member first: a role that needs a licence number is refused before the login changes.
        if (staffRoles && staff && staff.staff_category !== preset.id) {
          if (!canEditStaff) throw new Error(`Change ${staff.name}'s designation under that business's Staff.`);
          await saveHospitalStaff(staff.id, { ...staff, staff_category: preset.id, designation: undefined });
        }
        const keys = visibleNavFor(typeId, null, null).map((n) => n.moduleKey);
        await updateUserPermissions(user.id, presetModules(preset, keys), presetActions(preset));
      }
      onSaved();
    } catch (e) {
      notify(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Edit login — ${user.username}`} onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-3">
        <Field label="Display Name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Keep the current sections</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-neutral-500">
          {staffRoles
            ? staff
              ? `Linked to ${staff.name} (${staff.designation ?? staff.staff_category ?? "no designation"}). A new role changes their designation too.`
              : "Not linked to a staff member: link it under Staff so reports and examinations carry the person's name and role."
            : "A new role replaces this login's sections and actions. Fine-tune them with Permissions."}
        </p>
        {roleChanged && <p className="text-xs text-amber-700">Saving replaces this login&apos;s sections and actions with those of {preset!.label}.</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button loading={saving} variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Modal>
  );
}
