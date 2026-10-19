import { createRepo } from "./base";
import type { Uom } from "../types";

export const uomsRepo = createRepo<Uom>("uoms");
