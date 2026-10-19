import { createTenantRepo } from "./base";
import type { TaskItem } from "../types2";

export const tasksRepo = createTenantRepo<TaskItem>("tasks");
