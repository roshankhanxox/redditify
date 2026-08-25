import { FolderOpen } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default function LibraryPage() {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header className="mb-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Library</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Your uploaded footage, images, and character cutouts — managed in one place.
        </p>
      </header>

      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen />
          </EmptyMedia>
          <EmptyTitle>Nothing here yet</EmptyTitle>
          <EmptyDescription>
            Asset management lands with Dashboard V2 Phase 5. Until then, your uploaded
            footage is available from the create form&rsquo;s &ldquo;My footage&rdquo; picker.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
