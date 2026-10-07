import { MemoryStore } from "@stwrd-auth/core/sessions";
import { coordinationScenarios } from "./coordinationScenarios.js";

coordinationScenarios("memory", () => new MemoryStore());
