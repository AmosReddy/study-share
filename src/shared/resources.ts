/** What a shared file is. The keys are stored in the database (see the check in the resources table). */
export const RESOURCE_TYPES = {
  notes: "Notes",
  pyq: "Previous year paper",
  study_material: "Study material",
  assignment: "Assignment",
  other: "Other",
} as const;

export type ResourceType = keyof typeof RESOURCE_TYPES;

/** The types in display order. */
export const RESOURCE_TYPE_VALUES = Object.keys(RESOURCE_TYPES) as ResourceType[];

/** A file is 'uploading' until the server has confirmed what reached storage; only 'ready' files are listed. */
export type ResourceStatus = "uploading" | "ready";

/** The length limits count characters people see (code points), as the database checks do. */
export const RESOURCE_LIMITS = {
  maxTitle: 120,
  maxSubject: 60,
  maxFileName: 200,
  maxFileBytes: 25 * 1024 * 1024,
} as const;
