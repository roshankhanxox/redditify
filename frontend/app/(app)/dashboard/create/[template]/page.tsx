import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { StoryWizard } from "@/components/create/story-wizard";
import { TEMPLATES, type TemplateId } from "@/lib/wizard";
import { Clapperboard } from "lucide-react";

const TEMPLATE_IDS = TEMPLATES.map((t) => t.id) as TemplateId[];

export default async function CreateTemplatePage({
  params,
}: {
  params: Promise<{ template: string }>;
}) {
  const { template } = await params;
  if (!TEMPLATE_IDS.includes(template as TemplateId)) notFound();

  if (template !== "story") {
    return (
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clapperboard />
            </EmptyMedia>
            <EmptyTitle>Coming soon</EmptyTitle>
            <EmptyDescription>
              This format is part of the next Dashboard V2 phases. Story Reel is
              available today.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild variant="outline">
            <Link href="/dashboard/create/story">Use Story Reel instead</Link>
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <Suspense fallback={null}>
        <StoryWizard />
      </Suspense>
    </div>
  );
}
