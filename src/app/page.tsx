import { AppShell } from "@/client/components/app-shell/app-shell";

// Sample data for the Phase 0 shell. Real groups arrive in Phase 1.
const sampleGroups = [
  { id: "cse-2y", name: "CSE 2nd Year" },
  { id: "dbms", name: "DBMS" },
  { id: "friends", name: "Friends" },
  {
    id: "long",
    name: "Department of Computer Science and Engineering, Batch of 2028, Section B, Semester 4 revision group for all electives and labs",
  },
];

export default function Home() {
  return (
    <AppShell groups={sampleGroups} activeGroupId="cse-2y">
      <div className="mx-auto flex max-w-xl flex-col items-start gap-3 pt-10 lg:pt-20">
        <h1 className="text-3xl font-semibold">No files here yet</h1>
        <p className="max-w-prose text-muted-foreground">
          Each group gets its own library of notes, previous year papers and study material, sorted by subject,
          semester and type. Uploading will be available soon.
        </p>
      </div>
    </AppShell>
  );
}
