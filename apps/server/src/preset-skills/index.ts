import workspaceGuide from "./workspace-guide/SKILL.md" with { type: "text" };
import getStarted from "./get-started/SKILL.md" with { type: "text" };
import excelAnalysis from "./excel-analysis/SKILL.md" with { type: "text" };
import excelLayoutClassifier from "./excel-layout-classifier/SKILL.md" with { type: "text" };
import excelReadStrategy from "./excel-read-strategy/SKILL.md" with { type: "text" };
import excelWriteStrategy from "./excel-write-strategy/SKILL.md" with { type: "text" };

export const PRESET_SKILL_META_FILE = ".meta.json"
export const presetSkills: string[] = [workspaceGuide, getStarted, excelAnalysis, excelLayoutClassifier, excelReadStrategy, excelWriteStrategy];
