import { usePrototype } from "@/contexts/PrototypeContext";
import { WorkspaceStorageControls } from "./WorkspaceStorageControls";

/** A protected legacy/corrupt/quota workspace must not look like a broken role
 * selector. Keep recovery explicit, with no automatic load or replacement. */
export function WorkspaceStorageBanner() {
  const { storage } = usePrototype();
  if (storage.kind === "ready" || storage.kind === "identity-pending")
    return null;
  return (
    <details className="workspace-storage-banner">
      <summary>
        <strong>تنبيه الحفظ والاسترداد · افتح الخيارات</strong>
        <span>{storage.message}</span>
      </summary>
      <WorkspaceStorageControls />
    </details>
  );
}
