import { createTenantRepo } from "./base";
import type { Attendance } from "../types2";

export const attendanceRepo = createTenantRepo<Attendance>("attendance");
