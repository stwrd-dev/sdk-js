import { MemoryStore } from "@stwrd/core/sessions";
import { coordinationScenarios } from "./coordinationScenarios.js";

coordinationScenarios("memory", () => new MemoryStore());
