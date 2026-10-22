"use client";

import { useEffect, useState } from "react";
import { Eye, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { tasksRepo } from "@/lib/repo/tasks";
import { salesmenRepo } from "@/lib/repo/salesmen";
import type { TaskItem } from "@/lib/types2";
import type { Salesman } from "@/lib/types2";

export default function TasksPage() {
  const [rows, setRows] = useState<TaskItem[]>([]);
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [viewing, setViewing] = useState<TaskItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [taskName, setTaskName] = useState("");
  const [assignBy, setAssignBy] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [status, setStatus] = useState("Pending");
  const [finishedDate, setFinishedDate] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    const [taskRows, salesmenRows] = await Promise.all([
      tasksRepo.list({ orderBy: "assign_date DESC" }),
      salesmenRepo.list(),
    ]);
    setRows(taskRows);
    setSalesmen(salesmenRows);
  }

  useEffect(() => {
    void reload();
  }, []);

  function openAdd() {
    setEditing(null);
    setTaskName("");
    setAssignBy("");
    setAssignTo("");
    setStatus("Pending");
    setFinishedDate("");
    setDescription("");
    setModalOpen(true);
  }

  function openEdit(t: TaskItem) {
    setEditing(t);
    setTaskName(t.task_name);
    setAssignBy(t.assign_by ?? "");
    setAssignTo(t.assign_to ?? "");
    setStatus(t.status);
    setFinishedDate(t.finished_date ?? "");
    setDescription(t.description ?? "");
    setModalOpen(true);
  }

  async function handleDelete(t: TaskItem) {
    const reason = window.prompt(`Delete task "${t.task_name}"? Reason:`);
    if (reason === null) return;
    setDeletingId(t.id);
    try {
      await tasksRepo.remove(t.id, reason || undefined, "Task");
      void reload();
    } finally {
      setDeletingId(null);
    }
  }

  function printTask(t: TaskItem) {
    setViewing(t);
    setTimeout(() => window.print(), 150);
  }

  const columns: Column<TaskItem>[] = [
    { header: "Assign Date", render: (t) => t.assign_date },
    { header: "Task", render: (t) => t.task_name },
    { header: "Assign By", render: (t) => t.assign_by ?? "\u2014" },
    { header: "Assign To", render: (t) => t.assign_to ?? "\u2014" },
    {
      header: "Status",
      render: (t) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            t.status === "Completed"
              ? "bg-emerald-100 text-emerald-800"
              : t.status === "In Progress"
                ? "bg-amber-100 text-amber-800"
                : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {t.status}
        </span>
      ),
    },
    { header: "Finished Date", render: (t) => t.finished_date ?? "\u2014" },
    {
      header: "Actions",
      render: (t) => (
        <div className="flex items-center gap-2.5 text-neutral-500">
          <button
            type="button"
            title="View"
            onClick={(e) => {
              e.stopPropagation();
              setViewing(t);
            }}
            className="hover:text-amber-700"
          >
            <Eye size={16} />
          </button>
          <button
            type="button"
            title="Print"
            onClick={(e) => {
              e.stopPropagation();
              printTask(t);
            }}
            className="hover:text-amber-700"
          >
            <Printer size={16} />
          </button>
          <button
            type="button"
            title="Delete"
            disabled={deletingId === t.id}
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(t);
            }}
            className="hover:text-rose-600 disabled:opacity-40"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Task Details"
        actions={
          <>
            <Button variant="primary" onClick={openAdd}>
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage tasks.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} onRowClick={openEdit} />
      )}

      {modalOpen && (
        <Modal title={editing ? "-:Edit Task:-" : "-:Add Task:-"} onClose={() => setModalOpen(false)} width="max-w-lg">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!taskName.trim()) return;
              setSaving(true);
              try {
                const payload = {
                  assign_date: editing?.assign_date ?? new Date().toISOString().slice(0, 10),
                  task_name: taskName.trim(),
                  assign_by: assignBy || null,
                  assign_to: assignTo || null,
                  status,
                  finished_date: finishedDate || null,
                  description: description || null,
                };
                if (editing) await tasksRepo.update(editing.id, payload);
                else await tasksRepo.create(payload);
                setModalOpen(false);
                void reload();
              } finally {
                setSaving(false);
              }
            }}
          >
            <Field label="Task Name" required>
              <Input value={taskName} onChange={(e) => setTaskName(e.target.value)} required autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assign By">
                <Select value={assignBy} onChange={(e) => setAssignBy(e.target.value)}>
                  <option value="">Select...</option>
                  {salesmen.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Assign To">
                <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                  <option value="">Select...</option>
                  {salesmen.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" required>
                <Select value={status} onChange={(e) => setStatus(e.target.value)} required>
                  <option value="Pending">Pending</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                </Select>
              </Field>
              <Field label="Finished Date">
                <Input type="date" value={finishedDate} onChange={(e) => setFinishedDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Description">
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal title="-:Task Detail:-" onClose={() => setViewing(null)} width="max-w-lg">
          <div className="flex justify-end pb-3">
            <Button onClick={() => window.print()}>Print</Button>
          </div>
          <div className="print-area rounded-lg border border-neutral-200 p-5 text-sm">
            <h3 className="mb-3 font-serif text-lg text-neutral-800">{viewing.task_name}</h3>
            <div className="grid grid-cols-2 gap-3 text-neutral-600">
              <p>
                <span className="font-medium text-neutral-800">Assign Date:</span> {viewing.assign_date}
              </p>
              <p>
                <span className="font-medium text-neutral-800">Status:</span> {viewing.status}
              </p>
              <p>
                <span className="font-medium text-neutral-800">Assign By:</span> {viewing.assign_by ?? "\u2014"}
              </p>
              <p>
                <span className="font-medium text-neutral-800">Assign To:</span> {viewing.assign_to ?? "\u2014"}
              </p>
              <p>
                <span className="font-medium text-neutral-800">Finished Date:</span> {viewing.finished_date ?? "\u2014"}
              </p>
            </div>
            {viewing.description && (
              <p className="mt-3 text-neutral-600">
                <span className="font-medium text-neutral-800">Description:</span> {viewing.description}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
